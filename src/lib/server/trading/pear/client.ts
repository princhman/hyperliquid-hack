/**
 * Real Pear Protocol trading client
 * Extracts existing logic into the TradingClient interface
 */

import type {
  TradingClient,
  CreatePositionRequest,
  ClosePositionRequest,
  CloseAllPositionsRequest,
  CloseAllPositionsResult,
  PositionUpdateCallback,
} from "../types";
import type {
  SinglePositionAction,
  CreatePositionResult,
  ClosePositionResult,
} from "$lib/types/positions";
import type { Id } from "../../../../convex/_generated/dataModel";
import { convexClient } from "$lib/server/convex";
import { api } from "../../../../convex/_generated/api";
// Note: paths are relative from src/lib/server/trading/pear/ to src/convex/

const PEAR_API_BASE = "https://hl-v2.pearprotocol.io";
const PEAR_WS_URL = "wss://hl-v2.pearprotocol.io/ws";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface WebSocketSubscription {
  ws: WebSocket;
  address: string;
  lobbyId: Id<"lobby">;
}

// Track active subscriptions by address
const activeSubscriptions = new Map<string, WebSocketSubscription>();

export class PearTradingClient implements TradingClient {
  async getPositions(
    address: string,
    authToken: string,
  ): Promise<SinglePositionAction[]> {
    const res = await fetch(`${PEAR_API_BASE}/positions`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${authToken}`,
        Accept: "*/*",
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to get positions: ${res.statusText}`);
    }

    return res.json();
  }

  async createPosition(
    request: CreatePositionRequest,
    authToken: string,
  ): Promise<CreatePositionResult> {
    const { userId, lobbyId, ...config } = request;

    // 1. Get existing positions to know which IDs already exist
    const existingPositions = await this.getPositions(
      request.address,
      authToken,
    );
    const existingIds = new Set(existingPositions.map((p) => p.positionId));

    // 2. Create the position
    const createRes = await fetch(`${PEAR_API_BASE}/positions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
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
      return {
        success: false,
        error: createResult.message || "Failed to create position",
        orderId: null,
        positionId: null,
      };
    }

    // 3. Poll for the new position
    const maxAttempts = 30;
    const pollInterval = 1000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await sleep(pollInterval);

      const currentPositions = await this.getPositions(
        request.address,
        authToken,
      );

      const newPosition = currentPositions.find(
        (pos) =>
          !existingIds.has(pos.positionId) &&
          pos.longAssets.some((a) => a.coin === config.longAsset) &&
          pos.shortAssets.some((a) => a.coin === config.shortAsset) &&
          pos.longAssets.some((a) => a.leverage === config.leverage),
      );

      if (newPosition) {
        const positionCost = newPosition.marginUsed;

        // 4. Create userToPositions record in Convex
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

          return {
            success: true,
            orderId: createResult.orderId,
            positionId: newPosition.positionId,
            error: null,
            newBalance: convexResult.newBalance,
            positionCost,
          };
        } catch (error) {
          console.error("Failed to create userToPositions record:", error);
          return {
            success: true,
            orderId: createResult.orderId,
            positionId: newPosition.positionId,
            error: `Position created but failed to update database: ${error}`,
          };
        }
      }
    }

    return {
      success: true,
      orderId: createResult.orderId,
      positionId: null,
      error:
        "Position created but could not retrieve positionId within timeout",
    };
  }

  async closePosition(
    request: ClosePositionRequest,
    authToken: string,
  ): Promise<ClosePositionResult> {
    const { positionId, ...config } = request;

    // 1. Fetch current position to get the latest value
    const positions = await this.getPositions("", authToken);
    const currentPosition = positions.find((p) => p.positionId === positionId);

    if (!currentPosition) {
      return {
        success: false,
        error: "Position not found or already closed",
        realizedValue: null,
        newBalance: null,
      };
    }

    const realizedValue =
      currentPosition.positionValue + currentPosition.unrealizedPnl;

    // 2. Close the position on Pear API
    const closeRes = await fetch(
      `${PEAR_API_BASE}/positions/${positionId}/close`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
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
      return {
        success: false,
        error: closeResult.message || "Failed to close position",
        realizedValue: null,
        newBalance: null,
      };
    }

    // 3. Poll until position is gone
    const maxAttempts = 30;
    const pollInterval = 1000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await sleep(pollInterval);

      const currentPositions = await this.getPositions("", authToken);
      const stillExists = currentPositions.some(
        (p) => p.positionId === positionId,
      );

      if (!stillExists) {
        try {
          const convexResult = await convexClient.mutation(
            api.positions.closeUserPosition,
            {
              positionId,
              realizedValue,
            },
          );

          return {
            success: true,
            realizedValue,
            newBalance: convexResult.newBalance ?? null,
            error: null,
          };
        } catch (error) {
          console.error("Failed to update Convex after position close:", error);
          return {
            success: true,
            realizedValue,
            newBalance: null,
            error: "Position closed but failed to update database",
          };
        }
      }
    }

    return {
      success: false,
      error: "Close initiated but position still exists after timeout",
      realizedValue: null,
      newBalance: null,
    };
  }

  async closeAllPositions(
    request: CloseAllPositionsRequest,
    authToken: string,
  ): Promise<CloseAllPositionsResult> {
    const { address, lobbyId, executionType = "MARKET" } = request;

    // Stop WebSocket sync first
    this.stopSubscription(address);

    // Fetch all current positions
    const positions = await this.getPositions(address, authToken);

    if (positions.length === 0) {
      return {
        success: true,
        closedCount: 0,
        failedCount: 0,
        totalRealizedValue: 0,
        results: [],
        error: null,
      };
    }

    const results: CloseAllPositionsResult["results"] = [];
    let totalRealizedValue = 0;

    for (const position of positions) {
      const realizedValue = position.positionValue + position.unrealizedPnl;

      try {
        const closeRes = await fetch(
          `${PEAR_API_BASE}/positions/${position.positionId}/close`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${authToken}`,
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

    // Poll until all positions are closed
    const maxAttempts = 60;
    const pollInterval = 1000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await sleep(pollInterval);
      const remainingPositions = await this.getPositions(address, authToken);
      if (remainingPositions.length === 0) {
        break;
      }
    }

    const closedCount = results.filter((r) => r.success).length;
    const failedCount = results.filter((r) => !r.success).length;

    return {
      success: failedCount === 0,
      closedCount,
      failedCount,
      totalRealizedValue,
      results,
      error:
        failedCount > 0 ? `${failedCount} positions failed to close` : null,
    };
  }

  subscribeToPositions(
    address: string,
    lobbyId: Id<"lobby">,
    callback: PositionUpdateCallback,
  ): () => void {
    if (activeSubscriptions.has(address)) {
      console.log(`Position sync already active for ${address}`);
      return () => this.stopSubscription(address);
    }

    const ws = new WebSocket(PEAR_WS_URL);

    ws.onopen = () => {
      console.log(`WebSocket connected for ${address}`);
      ws.send(
        JSON.stringify({
          action: "subscribe",
          address,
          channels: ["positions"],
        }),
      );
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.channel === "positions" && data.data) {
          const positions: SinglePositionAction[] = Array.isArray(data.data)
            ? data.data
            : [data.data];

          callback(positions);

          const positionValues = positions.map((pos) => ({
            positionId: pos.positionId,
            positionValue: pos.positionValue,
            unrealizedPnl: pos.unrealizedPnl,
          }));

          await convexClient.mutation(api.positions.syncPositionValues, {
            lobbyId,
            positionValues,
          });

          console.log(
            `Synced ${positions.length} positions for ${address} in lobby ${lobbyId}`,
          );
        }
      } catch (error) {
        console.error("Error processing WebSocket message:", error);
      }
    };

    ws.onerror = (error) => {
      console.error(`WebSocket error for ${address}:`, error);
    };

    ws.onclose = () => {
      console.log(`WebSocket closed for ${address}`);
      activeSubscriptions.delete(address);
    };

    activeSubscriptions.set(address, { ws, address, lobbyId });

    return () => this.stopSubscription(address);
  }

  isSubscriptionActive(address: string): boolean {
    return activeSubscriptions.has(address);
  }

  stopSubscription(address: string): void {
    const subscription = activeSubscriptions.get(address);
    if (subscription) {
      subscription.ws.close();
      activeSubscriptions.delete(address);
      console.log(`Stopped position sync for ${address}`);
    }
  }
}

// Singleton instance
export const pearTradingClient = new PearTradingClient();
