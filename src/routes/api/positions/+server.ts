import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import type {
  CreatePositionConfig,
  CreatePositionResult,
  SinglePositionAction,
} from "$lib/types/positions";
import { convexClient } from "$lib/server/convex";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { getTradingClient } from "$lib/server/trading";

function getAuthToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.replace("Bearer ", "");
}

export const GET: RequestHandler = async ({ request, url }) => {
  const authToken = getAuthToken(request);
  if (!authToken) {
    return json(
      { error: "Missing or invalid Authorization header" },
      { status: 401 },
    );
  }

  const lobbyId = url.searchParams.get("lobbyId") as Id<"lobby"> | null;
  const address = url.searchParams.get("address");

  // If lobbyId is provided, check if it's a demo lobby
  let isDemo = false;
  if (lobbyId) {
    const lobby = await convexClient.query(api.lobby.getLobby, { lobbyId });
    isDemo = lobby?.isDemo ?? false;
  }

  const client = getTradingClient(isDemo);
  const positions = await client.getPositions(address || "", authToken);

  return json(positions);
};

interface CreatePositionBody extends CreatePositionConfig {
  userId: Id<"users">;
  lobbyId: Id<"lobby">;
  address: string;
}

export const POST: RequestHandler = async ({ request }) => {
  const authToken = getAuthToken(request);
  if (!authToken) {
    return json(
      { error: "Missing or invalid Authorization header" },
      { status: 401 },
    );
  }

  const body: CreatePositionBody = await request.json();
  const { userId, lobbyId, address, ...config } = body;

  if (!userId || !lobbyId) {
    return json({ error: "userId and lobbyId are required" }, { status: 400 });
  }

  if (!address) {
    return json({ error: "address is required" }, { status: 400 });
  }

  // Check if this is a demo lobby
  const lobby = await convexClient.query(api.lobby.getLobby, { lobbyId });
  if (!lobby) {
    return json({ error: "Lobby not found" }, { status: 404 });
  }

  const isDemo = lobby.isDemo ?? false;
  const client = getTradingClient(isDemo);

  const result = await client.createPosition(
    {
      userId,
      lobbyId,
      address,
      ...config,
    },
    authToken,
  );

  if (!result.success) {
    return json(result, { status: 400 });
  }

  return json(result);
};
