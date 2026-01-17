import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import type { SinglePositionAction } from "$lib/types/positions";
import { convexClient } from "$lib/server/convex";
import { stopPositionSync } from "$lib/server/positionSync";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

const PEAR_API_BASE = "https://hl-v2.pearprotocol.io";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getAuthHeader(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  return authHeader;
}

interface CloseAllBody {
  address: string;
  lobbyId: Id<"lobby">;
  executionType?: "MARKET" | "TWAP";
}

interface CloseAllResult {
  success: boolean;
  closedCount: number;
  failedCount: number;
  totalRealizedValue: number;
  results: Array<{
    positionId: string;
    success: boolean;
    realizedValue: number | null;
    error: string | null;
  }>;
  error: string | null;
}

export const POST: RequestHandler = async ({ request }) => {
  const authHeader = getAuthHeader(request);
  if (!authHeader) {
    return json(
      { error: "Missing or invalid Authorization header" },
      { status: 401 },
    );
  }

  const body: CloseAllBody = await request.json();
  const { address, lobbyId, executionType = "MARKET" } = body;

  if (!address || !lobbyId) {
    return json(
      { error: "address and lobbyId are required" },
      { status: 400 },
    );
  }

  // 1. Stop the WebSocket sync first
  stopPositionSync(address);

  // 2. Fetch all current positions
  const positionsRes = await fetch(`${PEAR_API_BASE}/positions`, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      Accept: "*/*",
    },
  });
  const positions: SinglePositionAction[] = await positionsRes.json();

  if (positions.length === 0) {
    const result: CloseAllResult = {
      success: true,
      closedCount: 0,
      failedCount: 0,
      totalRealizedValue: 0,
      results: [],
      error: null,
    };
    return json(result);
  }

  // 3. Close each position and track results
  const results: CloseAllResult["results"] = [];
  let totalRealizedValue = 0;

  for (const position of positions) {
    const realizedValue = position.positionValue + position.unrealizedPnl;

    try {
      // Close on Pear API
      const closeRes = await fetch(
        `${PEAR_API_BASE}/positions/${position.positionId}/close`,
        {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ executionType }),
        },
      );

      if (!closeRes.ok) {
        const errorData = await closeRes.json();
        results.push({
          positionId: position.positionId,
          success: false,
          realizedValue: null,
          error: errorData.message || "Failed to close position",
        });
        continue;
      }

      // Update Convex
      try {
        await convexClient.mutation(api.positions.closeUserPosition, {
          positionId: position.positionId,
          realizedValue,
        });
      } catch (convexError) {
        console.error(
          `Failed to update Convex for position ${position.positionId}:`,
          convexError,
        );
      }

      totalRealizedValue += realizedValue;
      results.push({
        positionId: position.positionId,
        success: true,
        realizedValue,
        error: null,
      });
    } catch (error) {
      results.push({
        positionId: position.positionId,
        success: false,
        realizedValue: null,
        error: `${error}`,
      });
    }
  }

  // 4. Poll until all positions are closed
  const maxAttempts = 60;
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

    const remainingPositions: SinglePositionAction[] = await pollRes.json();

    if (remainingPositions.length === 0) {
      break;
    }
  }

  const closedCount = results.filter((r) => r.success).length;
  const failedCount = results.filter((r) => !r.success).length;

  const result: CloseAllResult = {
    success: failedCount === 0,
    closedCount,
    failedCount,
    totalRealizedValue,
    results,
    error: failedCount > 0 ? `${failedCount} positions failed to close` : null,
  };

  return json(result);
};
