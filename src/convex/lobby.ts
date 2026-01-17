import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Get all lobbies (optionally filter by status)
 */
export const getLobbies = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("not started"),
        v.literal("started"),
        v.literal("finished"),
      ),
    ),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    let lobbies;
    if (args.status) {
      lobbies = await ctx.db
        .query("lobby")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    } else {
      lobbies = await ctx.db.query("lobby").collect();
    }

    // Get creator info for each lobby
    const lobbiesWithCreator = await Promise.all(
      lobbies.map(async (lobby) => {
        const creator = await ctx.db.get(lobby.createdBy);
        const participants = await ctx.db
          .query("userToLobby")
          .filter((q) => q.eq(q.field("lobbyId"), lobby._id))
          .collect();

        // Check if current user has joined
        const hasJoined = args.userId
          ? participants.some((p) => p.userId === args.userId)
          : false;

        return {
          ...lobby,
          creatorName: creator?.username || "Unknown",
          participantCount: participants.length,
          hasJoined,
        };
      }),
    );

    return lobbiesWithCreator;
  },
});

/**
 * Get a single lobby by ID
 */
export const getLobby = query({
  args: {
    lobbyId: v.id("lobby"),
  },
  handler: async (ctx, args) => {
    const lobby = await ctx.db.get(args.lobbyId);
    if (!lobby) return null;

    const creator = await ctx.db.get(lobby.createdBy);
    const participants = await ctx.db
      .query("userToLobby")
      .filter((q) => q.eq(q.field("lobbyId"), lobby._id))
      .collect();

    // Get user info for each participant
    const participantsWithInfo = await Promise.all(
      participants.map(async (p) => {
        const user = await ctx.db.get(p.userId);
        return {
          ...p,
          username: user?.username || "Unknown",
        };
      }),
    );

    return {
      ...lobby,
      creatorName: creator?.username || "Unknown",
      participants: participantsWithInfo,
    };
  },
});

/**
 * Create a new lobby
 */
export const createLobby = mutation({
  args: {
    name: v.string(),
    createdBy: v.id("users"),
    startTime: v.number(),
    endTime: v.number(),
    buyIn: v.number(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("lobby", {
      name: args.name,
      status: "not started",
      createdBy: args.createdBy,
      createdAt: Date.now(),
      startTime: args.startTime,
      endTime: args.endTime,
      buyIn: args.buyIn,
    });

    return { id };
  },
});

/**
 * Join a lobby
 */
export const joinLobby = mutation({
  args: {
    userId: v.id("users"),
    lobbyId: v.id("lobby"),
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if already joined
    const existing = await ctx.db
      .query("userToLobby")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), args.userId),
          q.eq(q.field("lobbyId"), args.lobbyId),
        ),
      )
      .first();

    if (existing) {
      throw new Error("Already joined this lobby");
    }

    // Get lobby to check buy-in
    const lobby = await ctx.db.get(args.lobbyId);
    if (!lobby) {
      throw new Error("Lobby not found");
    }

    if (lobby.status !== "not started") {
      throw new Error("Cannot join a lobby that has already started");
    }

    const id = await ctx.db.insert("userToLobby", {
      userId: args.userId,
      lobbyId: args.lobbyId,
      walletAddress: args.walletAddress.toLowerCase(),
      balance: lobby.buyIn,
      valueInPositions: 0,
    });

    return { id };
  },
});

/**
 * Check if user is in a lobby
 */
export const isUserInLobby = query({
  args: {
    userId: v.id("users"),
    lobbyId: v.id("lobby"),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("userToLobby")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), args.userId),
          q.eq(q.field("lobbyId"), args.lobbyId),
        ),
      )
      .first();

    return !!membership;
  },
});
