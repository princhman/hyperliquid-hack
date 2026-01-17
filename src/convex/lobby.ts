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

    // Create the lobby
    const lobbyId = await ctx.db.insert("lobby", {
      name: args.name,
      status: "not started",
      createdBy: user._id,
      createdAt: Date.now(),
      startTime: args.startTime,
      endTime: args.endTime,
      buyIn: args.buyIn,
    });

    return {
      lobbyId,
      name: args.name,
    };
  },
});

/**
 * Get all lobbies
 */
export const getLobbies = query({
  args: {},
  handler: async (ctx) => {
    const lobbies = await ctx.db.query("lobby").collect();
    return lobbies;
  },
});

/**
 * Get lobbies by status
 */
export const getLobbiesByStatus = query({
  args: {
    status: v.union(
      v.literal("not started"),
      v.literal("started"),
      v.literal("finished")
    ),
  },
  handler: async (ctx, args) => {
    const lobbies = await ctx.db
      .query("lobby")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .collect();
    return lobbies;
  },
});
