import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  startPositionSync,
  stopPositionSync,
  isPositionSyncActive,
} from "$lib/server/positionSync";
import type { Id } from "../../../../convex/_generated/dataModel";

interface StartSyncBody {
  address: string;
  lobbyId: Id<"lobby">;
}

interface StopSyncBody {
  address: string;
}

// POST - Start position sync for an address
export const POST: RequestHandler = async ({ request }) => {
  const body: StartSyncBody = await request.json();
  const { address, lobbyId } = body;

  if (!address || !lobbyId) {
    return json(
      { error: "address and lobbyId are required" },
      { status: 400 },
    );
  }

  if (isPositionSyncActive(address)) {
    return json({
      success: true,
      message: "Position sync already active",
      address,
    });
  }

  startPositionSync(address, lobbyId);

  return json({
    success: true,
    message: "Position sync started",
    address,
    lobbyId,
  });
};

// DELETE - Stop position sync for an address
export const DELETE: RequestHandler = async ({ request }) => {
  const body: StopSyncBody = await request.json();
  const { address } = body;

  if (!address) {
    return json({ error: "address is required" }, { status: 400 });
  }

  stopPositionSync(address);

  return json({
    success: true,
    message: "Position sync stopped",
    address,
  });
};

// GET - Check if sync is active for an address
export const GET: RequestHandler = async ({ url }) => {
  const address = url.searchParams.get("address");

  if (!address) {
    return json({ error: "address query param is required" }, { status: 400 });
  }

  const isActive = isPositionSyncActive(address);

  return json({
    address,
    isActive,
  });
};
