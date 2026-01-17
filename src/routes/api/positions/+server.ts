import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import type {
  CreatePositionConfig,
  CreatePositionResult,
  SinglePositionAction,
} from "$lib/types/positions";
import { convexClient } from "$lib/server/convex";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const PEAR_API_BASE = "https://hl-v2.pearprotocol.io";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getAuthHeader(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  return authHeader;
}

export const GET: RequestHandler = async ({ request }) => {
  const authHeader = getAuthHeader(request);
  if (!authHeader) {
    return json(
      { error: "Missing or invalid Authorization header" },
      { status: 401 },
    );
  }

  const res = await fetch(`${PEAR_API_BASE}/positions`, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      Accept: "*/*",
    },
  });

  const positions: SinglePositionAction[] = await res.json();
  return json(positions);
};

interface CreatePositionBody extends CreatePositionConfig {
  userId: Id<"users">;
  lobbyId: Id<"lobby">;
}

export const POST: RequestHandler = async ({ request }) => {
  const authHeader = getAuthHeader(request);
  if (!authHeader) {
    return json(
      { error: "Missing or invalid Authorization header" },
      { status: 401 },
    );
  }

  const body: CreatePositionBody = await request.json();
  const { userId, lobbyId, ...config } = body;

  if (!userId || !lobbyId) {
    return json({ error: "userId and lobbyId are required" }, { status: 400 });
  }

  // 1. Get existing positions to know which IDs already exist
  const existingPositionsRes = await fetch(`${PEAR_API_BASE}/positions`, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      Accept: "*/*",
    },
  });
  const existingPositions: SinglePositionAction[] =
    await existingPositionsRes.json();
  const existingIds = new Set(existingPositions.map((p) => p.positionId));

  // 2. Create the position
  const createRes = await fetch(`${PEAR_API_BASE}/positions`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      slippage: config.slippage,
      executionType: config.executionType,
      leverage: config.leverage,
      usdValue: config.usdValue,
      longAssets: [{ asset: config.longAsset, weight: 0.5 }],
      shortAssets: [{ asset: config.shortAsset, weight: 0.5 }],
    }),
  });

  const createResult = await createRes.json();

  if (!createResult.orderId) {
    const result: CreatePositionResult = {
      success: false,
      error: createResult.message || "Failed to create position",
      orderId: null,
      positionId: null,
    };
    return json(result, { status: 400 });
  }

  // 3. Poll for the new position (matching by assets and not in existing IDs)
  const maxAttempts = 30; // 30 attempts * 1 second = 30 seconds max
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

    // Find a new position that matches our criteria
    const newPosition = currentPositions.find(
      (pos) =>
        // Must be a new position
        !existingIds.has(pos.positionId) &&
        // Match long asset
        pos.longAssets.some((a) => a.coin === config.longAsset) &&
        // Match short asset
        pos.shortAssets.some((a) => a.coin === config.shortAsset) &&
        // Match leverage
        pos.longAssets.some((a) => a.leverage === config.leverage),
    );

    if (newPosition) {
      // Calculate position cost (marginUsed from the position)
      const positionCost = newPosition.marginUsed;

      // 4. Create userToPositions record in Convex and reduce balance
      try {
        const convexResult = await convexClient.mutation(
          api.positions.createUserPosition,
          {
            userId,
            lobbyId,
            positionId: newPosition.positionId,
            positionCost,
          },
        );

        const result: CreatePositionResult = {
          success: true,
          orderId: createResult.orderId,
          positionId: newPosition.positionId,
          error: null,
          newBalance: convexResult.newBalance,
          positionCost,
        };
        return json(result);
      } catch (error) {
        console.error("Failed to create userToPositions record:", error);
        const result: CreatePositionResult = {
          success: true,
          orderId: createResult.orderId,
          positionId: newPosition.positionId,
          error: `Position created but failed to update database: ${error}`,
        };
        return json(result);
      }
    }
  }

  // Timeout - position was created but we couldn't find it
  const result: CreatePositionResult = {
    success: true,
    orderId: createResult.orderId,
    positionId: null,
    error: "Position created but could not retrieve positionId within timeout",
  };
  return json(result);
};
