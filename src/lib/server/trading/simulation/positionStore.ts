/**
 * Persistent position store for simulation mode
 * Uses Convex for storage so positions survive server restarts
 */

import type { SinglePositionAction, AssetPosition } from "$lib/types/positions";
import type { Id } from "../../../../convex/_generated/dataModel";
import { convexClient } from "$lib/server/convex";
import { api } from "../../../../convex/_generated/api";
import { priceService } from "./priceService";

interface SimulatedPosition {
  positionId: string;
  address: string;
  lobbyId: Id<"lobby">;
  longAsset: string;
  shortAsset: string;
  leverage: number;
  usdValue: number;
  entryPriceLong: number;
  entryPriceShort: number;
  createdAt: number;
}

// Generate unique position ID
function generatePositionId(): string {
  return `sim_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create a new simulated position (persisted to Convex)
 */
export async function createSimulatedPosition(
  address: string,
  lobbyId: Id<"lobby">,
  longAsset: string,
  shortAsset: string,
  leverage: number,
  usdValue: number,
): Promise<SimulatedPosition> {
  // Get current prices
  const prices = await priceService.getPrices([longAsset, shortAsset]);
  const entryPriceLong = prices.get(longAsset) || 0;
  const entryPriceShort = prices.get(shortAsset) || 0;

  if (entryPriceLong === 0 || entryPriceShort === 0) {
    throw new Error(`Could not get prices for ${longAsset} or ${shortAsset}`);
  }

  const positionId = generatePositionId();

  // Store in Convex
  await convexClient.mutation(api.simulatedPositions.createSimulatedPosition, {
    positionId,
    address: address.toLowerCase(),
    lobbyId,
    longAsset,
    shortAsset,
    leverage,
    usdValue,
    entryPriceLong,
    entryPriceShort,
  });

  return {
    positionId,
    address: address.toLowerCase(),
    lobbyId,
    longAsset,
    shortAsset,
    leverage,
    usdValue,
    entryPriceLong,
    entryPriceShort,
    createdAt: Date.now(),
  };
}

/**
 * Get a simulated position by ID
 */
export async function getSimulatedPosition(
  positionId: string,
): Promise<SimulatedPosition | null> {
  const position = await convexClient.query(
    api.simulatedPositions.getPositionById,
    { positionId },
  );
  return position as SimulatedPosition | null;
}

/**
 * Delete a simulated position
 */
export async function deleteSimulatedPosition(
  positionId: string,
): Promise<SimulatedPosition | null> {
  const result = await convexClient.mutation(
    api.simulatedPositions.deletePosition,
    { positionId },
  );
  return result.position as SimulatedPosition | null;
}

/**
 * Get all simulated positions for an address
 */
export async function getSimulatedPositionsForAddress(
  address: string,
): Promise<SimulatedPosition[]> {
  const positions = await convexClient.query(
    api.simulatedPositions.getPositionsByAddress,
    { address: address.toLowerCase() },
  );
  return positions as SimulatedPosition[];
}

/**
 * Convert simulated position to Pear API format with current P&L
 */
export async function toSinglePositionAction(
  position: SimulatedPosition,
): Promise<SinglePositionAction> {
  // Get current prices
  const prices = await priceService.getPrices([
    position.longAsset,
    position.shortAsset,
  ]);
  const currentPriceLong =
    prices.get(position.longAsset) || position.entryPriceLong;
  const currentPriceShort =
    prices.get(position.shortAsset) || position.entryPriceShort;

  const halfValue = position.usdValue / 2;
  const marginUsed = position.usdValue / position.leverage;

  // Calculate position sizes
  const longSize = halfValue / position.entryPriceLong;
  const shortSize = halfValue / position.entryPriceShort;

  // Calculate current values
  const longCurrentValue = longSize * currentPriceLong;
  const shortCurrentValue = shortSize * currentPriceShort;

  // Long P&L: current value - entry value
  const longPnl = (longCurrentValue - halfValue) * position.leverage;
  // Short P&L: entry value - current value (profit when price drops)
  const shortPnl = (halfValue - shortCurrentValue) * position.leverage;

  const totalUnrealizedPnl = longPnl + shortPnl;
  const positionValue = marginUsed;
  const unrealizedPnlPercentage = (totalUnrealizedPnl / marginUsed) * 100;

  const entryRatio = position.entryPriceLong / position.entryPriceShort;
  const markRatio = currentPriceLong / currentPriceShort;

  const longAssetPosition: AssetPosition = {
    coin: position.longAsset,
    entryPrice: position.entryPriceLong,
    actualSize: longSize,
    leverage: position.leverage,
    marginUsed: marginUsed / 2,
    positionValue: positionValue / 2,
    unrealizedPnl: longPnl,
    entryPositionValue: halfValue,
    initialWeight: 0.5,
    fundingPaid: 0,
  };

  const shortAssetPosition: AssetPosition = {
    coin: position.shortAsset,
    entryPrice: position.entryPriceShort,
    actualSize: -shortSize,
    leverage: position.leverage,
    marginUsed: marginUsed / 2,
    positionValue: positionValue / 2,
    unrealizedPnl: shortPnl,
    entryPositionValue: halfValue,
    initialWeight: 0.5,
    fundingPaid: 0,
  };

  return {
    positionId: position.positionId,
    address: position.address,
    pearExecutionFlag: "SIMULATED",
    stopLoss: {
      type: "none",
      value: 0,
      isTrailing: false,
      trailingDeltaValue: 0,
      trailingActivationValue: 0,
    },
    takeProfit: {
      type: "none",
      value: 0,
      isTrailing: false,
      trailingDeltaValue: 0,
      trailingActivationValue: 0,
    },
    entryRatio,
    markRatio,
    entryPriceRatio: entryRatio,
    markPriceRatio: markRatio,
    entryPositionValue: position.usdValue,
    positionValue,
    marginUsed,
    unrealizedPnl: totalUnrealizedPnl,
    unrealizedPnlPercentage,
    longAssets: [longAssetPosition],
    shortAssets: [shortAssetPosition],
    createdAt: new Date(position.createdAt).toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Get all positions for an address in Pear API format
 */
export async function getPositionsAsSinglePositionActions(
  address: string,
): Promise<SinglePositionAction[]> {
  const positions = await getSimulatedPositionsForAddress(address);
  return Promise.all(positions.map(toSinglePositionAction));
}

/**
 * Calculate realized value when closing a position
 */
export async function calculateRealizedValue(
  positionId: string,
): Promise<number> {
  const position = await getSimulatedPosition(positionId);
  if (!position) {
    throw new Error(`Position ${positionId} not found`);
  }

  const positionAction = await toSinglePositionAction(position);
  return positionAction.marginUsed + positionAction.unrealizedPnl;
}
