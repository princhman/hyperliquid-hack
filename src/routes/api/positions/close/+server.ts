import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import type {
  ClosePositionConfig,
  ClosePositionResult,
} from "$lib/types/positions";
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

interface ClosePositionBody extends ClosePositionConfig {
  positionId: string;
  lobbyId: Id<"lobby">;
}

export const POST: RequestHandler = async ({ request }) => {
  const authToken = getAuthToken(request);
  if (!authToken) {
    return json(
      { error: "Missing or invalid Authorization header" },
      { status: 401 },
    );
  }

  const body: ClosePositionBody = await request.json();
  const { positionId, lobbyId, ...config } = body;

  if (!positionId) {
    return json({ error: "positionId is required" }, { status: 400 });
  }

  if (!lobbyId) {
    return json({ error: "lobbyId is required" }, { status: 400 });
  }

  // Check if this is a demo lobby
  const lobby = await convexClient.query(api.lobby.getLobby, { lobbyId });
  if (!lobby) {
    return json({ error: "Lobby not found" }, { status: 404 });
  }

  const isDemo = lobby.isDemo ?? false;
  const client = getTradingClient(isDemo);

  const result = await client.closePosition(
    {
      positionId,
      ...config,
    },
    authToken,
  );

  if (!result.success) {
    const status = result.error?.includes("not found") ? 404 : 400;
    return json(result, { status });
  }

  return json(result);
};
