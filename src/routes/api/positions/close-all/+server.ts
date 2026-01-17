import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { convexClient } from "$lib/server/convex";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { getTradingClient } from "$lib/server/trading";

function getAuthToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.replace("Bearer ", "");
}

interface CloseAllBody {
  address: string;
  lobbyId: Id<"lobby">;
  executionType?: "MARKET" | "TWAP";
}

export const POST: RequestHandler = async ({ request }) => {
  const authToken = getAuthToken(request);
  if (!authToken) {
    return json(
      { error: "Missing or invalid Authorization header" },
      { status: 401 },
    );
  }

  const body: CloseAllBody = await request.json();
  const { address, lobbyId, executionType = "MARKET" } = body;

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

  const result = await client.closeAllPositions(
    {
      address,
      lobbyId,
      executionType,
    },
    authToken,
  );

  return json(result);
};
