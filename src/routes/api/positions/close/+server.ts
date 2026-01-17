import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import type {
  ClosePositionConfig,
  ClosePositionResult,
  SinglePositionAction,
} from "$lib/types/positions";
import { convexClient } from "$lib/server/convex";
import { api } from "../../../../convex/_generated/api";

const PEAR_API_BASE = "https://hl-v2.pearprotocol.io";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getAuthHeader(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  return authHeader;
}

interface ClosePositionBody extends ClosePositionConfig {
  positionId: string;
}

export const POST: RequestHandler = async ({ request }) => {
  const authHeader = getAuthHeader(request);
  if (!authHeader) {
    return json(
      { error: "Missing or invalid Authorization header" },
      { status: 401 },
    );
  }

  const body: ClosePositionBody = await request.json();
  const { positionId, ...config } = body;

  if (!positionId) {
    return json({ error: "positionId is required" }, { status: 400 });
  }

  // 1. Fetch current position to get the latest value before closing
  const positionsRes = await fetch(`${PEAR_API_BASE}/positions`, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      Accept: "*/*",
    },
  });
  const positions: SinglePositionAction[] = await positionsRes.json();
  const currentPosition = positions.find((p) => p.positionId === positionId);

  if (!currentPosition) {
    const result: ClosePositionResult = {
      success: false,
      error: "Position not found or already closed",
      realizedValue: null,
      newBalance: null,
    };
    return json(result, { status: 404 });
  }

  // Calculate realized value (position value + unrealized PnL)
  const realizedValue =
    currentPosition.positionValue + currentPosition.unrealizedPnl;

  // 2. Close the position on Pear API
  const closeRes = await fetch(
    `${PEAR_API_BASE}/positions/${positionId}/close`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        executionType: config.executionType || "MARKET",
        twapDuration: config.twapDuration,
        twapIntervalSeconds: config.twapIntervalSeconds,
        randomizeExecution: config.randomizeExecution,
        referralCode: config.referralCode,
      }),
    },
  );

  const closeResult = await closeRes.json();

  if (!closeRes.ok) {
    const result: ClosePositionResult = {
      success: false,
      error: closeResult.message || "Failed to close position",
      realizedValue: null,
      newBalance: null,
    };
    return json(result, { status: closeRes.status });
  }

  // 3. Poll until position is no longer in the list (confirming closure)
  const maxAttempts = 30;
  const pollInterval = 1000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(pollInterval);

    const pollRes = await fetch(`${PEAR_API_BASE}/positions`, {
      method: "GET",
      headers: {
        Authorization: authHeader,
        Accept: "*/*",
      },
    });

    const currentPositions: SinglePositionAction[] = await pollRes.json();
    const stillExists = currentPositions.some((p) => p.positionId === positionId);

    if (!stillExists) {
      // Position closed successfully, update Convex
      try {
        const convexResult = await convexClient.mutation(
          api.positions.closeUserPosition,
          {
            positionId,
            realizedValue,
          },
        );

        const result: ClosePositionResult = {
          success: true,
          realizedValue,
          newBalance: convexResult.newBalance ?? null,
          error: null,
        };
        return json(result);
      } catch (error) {
        console.error("Failed to update Convex after position close:", error);
        // Position was closed on Pear but Convex update failed
        const result: ClosePositionResult = {
          success: true,
          realizedValue,
          newBalance: null,
          error: "Position closed but failed to update database",
        };
        return json(result);
      }
    }
  }

  // Timeout - close was initiated but position still exists
  const result: ClosePositionResult = {
    success: false,
    error: "Close initiated but position still exists after timeout",
    realizedValue: null,
    newBalance: null,
  };
  return json(result, { status: 408 });
};
