/**
 * Trading abstraction types
 * Shared interface between real Pear Protocol and simulation mode
 */

import type { Id } from "../../../convex/_generated/dataModel";
import type {
  SinglePositionAction,
  CreatePositionConfig,
  CreatePositionResult,
  ClosePositionConfig,
  ClosePositionResult,
} from "$lib/types/positions";

/**
 * Extended position config with game context
 */
export interface CreatePositionRequest extends CreatePositionConfig {
  userId: Id<"users">;
  lobbyId: Id<"lobby">;
  address: string;
}

/**
 * Close position request with game context
 */
export interface ClosePositionRequest extends ClosePositionConfig {
  positionId: string;
  userId?: Id<"users">;
  lobbyId?: Id<"lobby">;
}

/**
 * Close all positions request
 */
export interface CloseAllPositionsRequest {
  address: string;
  lobbyId: Id<"lobby">;
  executionType?: "MARKET" | "TWAP";
}

/**
 * Result from closing all positions
 */
export interface CloseAllPositionsResult {
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

/**
 * Callback for position updates (WebSocket or polling)
 */
export type PositionUpdateCallback = (
  positions: SinglePositionAction[],
) => void;

/**
 * Trading client interface - implemented by both Pear and Simulation
 */
export interface TradingClient {
  /**
   * Get all positions for an address
   */
  getPositions(
    address: string,
    authToken: string,
  ): Promise<SinglePositionAction[]>;

  /**
   * Create a new position
   */
  createPosition(
    request: CreatePositionRequest,
    authToken: string,
  ): Promise<CreatePositionResult>;

  /**
   * Close a single position
   */
  closePosition(
    request: ClosePositionRequest,
    authToken: string,
  ): Promise<ClosePositionResult>;

  /**
   * Close all positions for an address
   */
  closeAllPositions(
    request: CloseAllPositionsRequest,
    authToken: string,
  ): Promise<CloseAllPositionsResult>;

  /**
   * Subscribe to position updates
   * Returns an unsubscribe function
   */
  subscribeToPositions(
    address: string,
    lobbyId: Id<"lobby">,
    callback: PositionUpdateCallback,
  ): () => void;

  /**
   * Check if subscription is active
   */
  isSubscriptionActive(address: string): boolean;

  /**
   * Stop subscription for address
   */
  stopSubscription(address: string): void;
}

/**
 * Price data from external API
 */
export interface PriceData {
  symbol: string;
  price: number;
  timestamp: number;
}

/**
 * Price service interface
 */
export interface PriceService {
  /**
   * Get current price for a symbol
   */
  getPrice(symbol: string): Promise<number>;

  /**
   * Get prices for multiple symbols
   */
  getPrices(symbols: string[]): Promise<Map<string, number>>;

  /**
   * Subscribe to price updates
   */
  subscribeToPrices(
    symbols: string[],
    callback: (prices: Map<string, number>) => void,
  ): () => void;
}
