import { convexClient } from "./convex";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { SinglePositionAction } from "$lib/types/positions";

const PEAR_WS_URL = "wss://hl-v2.pearprotocol.io/ws";

interface WebSocketSubscription {
  ws: WebSocket;
  address: string;
  lobbyId: Id<"lobby">;
}

// Track active subscriptions by address
const activeSubscriptions = new Map<string, WebSocketSubscription>();

/**
 * Start syncing positions for a wallet address in a lobby
 */
export function startPositionSync(
  address: string,
  lobbyId: Id<"lobby">,
): void {
  // Don't create duplicate subscriptions
  if (activeSubscriptions.has(address)) {
    console.log(`Position sync already active for ${address}`);
    return;
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

      // Handle position updates
      if (data.channel === "positions" && data.data) {
        const positions: SinglePositionAction[] = Array.isArray(data.data)
          ? data.data
          : [data.data];

        const positionValues = positions.map((pos) => ({
          positionId: pos.positionId,
          positionValue: pos.positionValue,
          unrealizedPnl: pos.unrealizedPnl,
        }));

        // Sync to Convex
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
}

/**
 * Stop syncing positions for a wallet address
 */
export function stopPositionSync(address: string): void {
  const subscription = activeSubscriptions.get(address);
  if (subscription) {
    subscription.ws.close();
    activeSubscriptions.delete(address);
    console.log(`Stopped position sync for ${address}`);
  }
}

/**
 * Stop all active position syncs
 */
export function stopAllPositionSyncs(): void {
  for (const [address, subscription] of activeSubscriptions) {
    subscription.ws.close();
    console.log(`Stopped position sync for ${address}`);
  }
  activeSubscriptions.clear();
}

/**
 * Check if position sync is active for an address
 */
export function isPositionSyncActive(address: string): boolean {
  return activeSubscriptions.has(address);
}

/**
 * Get all active sync addresses
 */
export function getActiveSyncAddresses(): string[] {
  return Array.from(activeSubscriptions.keys());
}
