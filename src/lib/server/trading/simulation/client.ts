/**
 * Simulation trading client
 * Mimics Pear Protocol behavior with paper trading
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
import {
  createSimulatedPosition,
  getSimulatedPosition,
  deleteSimulatedPosition,
  getPositionsAsSinglePositionActions,
  calculateRealizedValue,
  toSinglePositionAction,
} from "./positionStore";

// Track active subscriptions
const activeSubscriptions = new Map<string, NodeJS.Timeout>();

export class SimulationTradingClient implements TradingClient {
  async getPositions(
    address: string,
    _authToken: string,
  ): Promise<SinglePositionAction[]> {
    return getPositionsAsSinglePositionActions(address);
  }

  async createPosition(
    request: CreatePositionRequest,
    _authToken: string,
  ): Promise<CreatePositionResult> {
    const { userId, lobbyId, address, ...config } = request;

    try {
      // Create simulated position (now persisted to Convex)
      const position = await createSimulatedPosition(
        address,
        lobbyId,
        config.longAsset,
        config.shortAsset,
        config.leverage,
        config.usdValue,
      );

      // Calculate margin used
      const positionCost = config.usdValue / config.leverage;

      // Create userToPositions record in Convex
      const convexResult = await convexClient.mutation(
        api.positions.createUserPosition,
        {
          userId,
          lobbyId,
          positionId: position.positionId,
          positionCost,
        },
      );

      return {
        success: true,
        orderId: `sim_order_${Date.now()}`,
        positionId: position.positionId,
        error: null,
        newBalance: convexResult.newBalance,
        positionCost,
      };
    } catch (error) {
      console.error("Failed to create simulated position:", error);
      return {
        success: false,
        orderId: null,
        positionId: null,
        error: `${error}`,
      };
    }
  }

  async closePosition(
    request: ClosePositionRequest,
    _authToken: string,
  ): Promise<ClosePositionResult> {
    const { positionId } = request;

    try {
      // Get position and calculate realized value
      const position = getSimulatedPosition(positionId);
      if (!position) {
        return {
          success: false,
          error: "Position not found or already closed",
          realizedValue: null,
          newBalance: null,
        };
      }

      const realizedValue = await calculateRealizedValue(positionId);

      // Delete from store
      deleteSimulatedPosition(positionId);

      // Update Convex
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
      console.error("Failed to close simulated position:", error);
      return {
        success: false,
        error: `${error}`,
        realizedValue: null,
        newBalance: null,
      };
    }
  }

  async closeAllPositions(
    request: CloseAllPositionsRequest,
    _authToken: string,
  ): Promise<CloseAllPositionsResult> {
    const { address } = request;

    // Stop subscription first
    this.stopSubscription(address);

    // Get all positions
    const positions = await this.getPositions(address, "");

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
      try {
        const realizedValue = await calculateRealizedValue(position.positionId);
        deleteSimulatedPosition(position.positionId);

        await convexClient.mutation(api.positions.closeUserPosition, {
          positionId: position.positionId,
          realizedValue,
        });

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
      return () => this.stopSubscription(address);
    }

    // Poll every 2 seconds and update positions with current prices
    const interval = setInterval(async () => {
      try {
        const positions = await getPositionsAsSinglePositionActions(address);

        if (positions.length > 0) {
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
        }
      } catch (error) {
        // Silently handle errors
      }
    }, 2000);

    activeSubscriptions.set(address, interval);

    return () => this.stopSubscription(address);
  }

  isSubscriptionActive(address: string): boolean {
    return activeSubscriptions.has(address);
  }

  stopSubscription(address: string): void {
    const interval = activeSubscriptions.get(address);
    if (interval) {
      clearInterval(interval);
      activeSubscriptions.delete(address);
    }
  }
}

// Singleton instance
export const simulationTradingClient = new SimulationTradingClient();
