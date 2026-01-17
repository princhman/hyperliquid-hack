import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Create a new lobby
 */
export const createLobby = mutation({
  args: {
    name: v.string(),
    walletAddress: v.string(),
    startTime: v.number(),
    endTime: v.number(),
    buyIn: v.number(),
    split: v.number(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    // Get user by wallet address
    const user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();

    if (!user) {
      throw new Error("User not found. Please log in first.");
    }

    // Validate start time is in the future
    if (args.startTime <= Date.now()) {
      throw new Error("Please select a start time that hasn't already passed.");
    }

    // Validate end time is not more than 24 hours after start time
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    if (args.endTime - args.startTime > ONE_DAY_MS) {
      throw new Error("Lobby duration cannot exceed 24 hours.");
    }

    if (args.endTime <= args.startTime) {
      throw new Error("End time must be after start time.");
    }

    // Step 1: Create the lobby
    const lobbyId = await ctx.db.insert("lobby", {
      name: args.name,
      status: "not started",
      createdBy: user._id,
      createdAt: Date.now(),
      startTime: args.startTime,
      endTime: args.endTime,
      buyIn: args.buyIn,
      split: args.split,
    });

    console.log("Lobby created with ID:", lobbyId);

    // Step 2: Create userToLobby entry (creator joins automatically)
    const userToLobbyId = await ctx.db.insert("userToLobby", {
      userId: user._id,
      lobbyId: lobbyId,
      walletAddress: walletAddress,
      balance: Number(args.buyIn),
      valueInPositions: 0.0,
    });

    console.log("UserToLobby created with ID:", userToLobbyId);

    return {
      lobbyId,
      name: args.name,
      userToLobbyId,
    };
  },
});

/**
 * List all lobbies
 */
export const getLobbies = query({
  args: {},
  handler: async (ctx) => {
    const lobbies = await ctx.db.query("lobby").collect();
    return lobbies;
  },
});

/**
 * Join a lobby (add user to userToLobby)
 */
export const joinLobby = mutation({
  args: {
    walletAddress: v.string(),
    lobbyId: v.id("lobby"),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    const user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();

    if (!user) {
      throw new Error("User not found. Please log in first.");
    }

    // Get lobby to get buy-in amount
    const lobby = await ctx.db.get(args.lobbyId);
    if (!lobby) {
      throw new Error("Lobby not found.");
    }

    // Check if already joined
    const existing = await ctx.db
      .query("userToLobby")
      .withIndex("by_lobbyId", (q) => q.eq("lobbyId", args.lobbyId))
      .collect();

    if (existing.some((u) => u.userId === user._id)) {
      throw new Error("Already joined this lobby.");
    }

    const userToLobbyId = await ctx.db.insert("userToLobby", {
      userId: user._id,
      lobbyId: args.lobbyId,
      walletAddress: walletAddress,
      balance: Number(lobby.buyIn),  // Use lobby's buy-in amount
      valueInPositions: 0.0,
    });

    return { userToLobbyId };
  },
});

/**
 * List all users in a lobby
 */
export const getUsersInLobby = query({
  args: {
    lobbyId: v.id("lobby"),
  },
  handler: async (ctx, args) => {
    const userToLobbyEntries = await ctx.db
      .query("userToLobby")
      .withIndex("by_lobbyId", (q) => q.eq("lobbyId", args.lobbyId))
      .collect();

    const userIds = userToLobbyEntries.map((entry) => entry.userId);
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));

    return users.filter(Boolean);
  },
});