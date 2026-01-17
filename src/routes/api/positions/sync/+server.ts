import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import type { Id } from "../../../../convex/_generated/dataModel";
import { convexClient } from "$lib/server/convex";
import { api } from "../../../../convex/_generated/api";
import { getTradingClient } from "$lib/server/trading";

interface StartSyncBody {
  address: string;
  lobbyId: Id<"lobby">;
}

interface StopSyncBody {
  address: string;
  lobbyId?: Id<"lobby">;
}

// POST - Start position sync for an address
export const POST: RequestHandler = async ({ request }) => {
  const body: StartSyncBody = await request.json();
  const { address, lobbyId } = body;

  if (!address || !lobbyId) {
    return json({ error: "address and lobbyId are required" }, { status: 400 });
  }

  // Check if this is a demo lobby
  const lobby = await convexClient.query(api.lobby.getLobby, { lobbyId });
  if (!lobby) {
    return json({ error: "Lobby not found" }, { status: 404 });
  }

  const isDemo = lobby.isDemo ?? false;
  const client = getTradingClient(isDemo);

  if (client.isSubscriptionActive(address)) {
    return json({
      success: true,
      message: "Position sync already active",
      address,
      isDemo,
    });
  }

  client.subscribeToPositions(address, lobbyId, () => {
    // Position updates handled internally
  });

  return json({
    success: true,
    message: "Position sync started",
    address,
    lobbyId,
    isDemo,
  });
};

// DELETE - Stop position sync for an address
export const DELETE: RequestHandler = async ({ request }) => {
  const body: StopSyncBody = await request.json();
  const { address, lobbyId } = body;

  if (!address) {
    return json({ error: "address is required" }, { status: 400 });
  }

  // Try to stop on both clients if we don't know which one
  if (lobbyId) {
    const lobby = await convexClient.query(api.lobby.getLobby, { lobbyId });
    const isDemo = lobby?.isDemo ?? false;
    const client = getTradingClient(isDemo);
    client.stopSubscription(address);
  } else {
    // Stop on both just to be safe
    const realClient = getTradingClient(false);
    const demoClient = getTradingClient(true);
    realClient.stopSubscription(address);
    demoClient.stopSubscription(address);
  }

  return json({
    success: true,
    message: "Position sync stopped",
    address,
  });
};

// GET - Check if sync is active for an address
export const GET: RequestHandler = async ({ url }) => {
  const address = url.searchParams.get("address");
  const lobbyId = url.searchParams.get("lobbyId") as Id<"lobby"> | null;

  if (!address) {
    return json({ error: "address query param is required" }, { status: 400 });
  }

  let isActive = false;
  let isDemo = false;

  if (lobbyId) {
    const lobby = await convexClient.query(api.lobby.getLobby, { lobbyId });
    isDemo = lobby?.isDemo ?? false;
    const client = getTradingClient(isDemo);
    isActive = client.isSubscriptionActive(address);
  } else {
    // Check both clients
    const realClient = getTradingClient(false);
    const demoClient = getTradingClient(true);
    isActive =
      realClient.isSubscriptionActive(address) ||
      demoClient.isSubscriptionActive(address);
    isDemo = demoClient.isSubscriptionActive(address);
  }

  return json({
    address,
    isActive,
    isDemo,
  });
};
