/**
 * Trading client factory
 * Returns the appropriate client based on demo mode
 */

import type { TradingClient } from "./types";
import { pearTradingClient } from "./pear/client";
import { simulationTradingClient } from "./simulation/client";

// Re-export types
export * from "./types";

/**
 * Get the appropriate trading client
 * @param isDemo - Whether to use simulation mode
 */
export function getTradingClient(isDemo: boolean): TradingClient {
  if (isDemo) {
    return simulationTradingClient;
  }
  return pearTradingClient;
}

/**
 * Get the Pear trading client (for real trading)
 */
export function getPearClient(): TradingClient {
  return pearTradingClient;
}

/**
 * Get the simulation trading client (for demo mode)
 */
export function getSimulationClient(): TradingClient {
  return simulationTradingClient;
}
