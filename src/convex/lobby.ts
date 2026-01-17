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

    // Step 1: Create the lobby
    const lobbyId = await ctx.db.insert("lobby", {
      name: args.name,
      status: "not started",
      createdBy: user._id,
      createdAt: Date.now(),
      startTime: args.startTime,
      endTime: args.endTime,
      buyIn: args.buyIn,
    });

    console.log("Lobby created with ID:", lobbyId);
    console.log("Now creating userToLobby with:", {
      userId: user._id,
      lobbyId: lobbyId,
      walletAddress: walletAddress,
      balance: Number(args.buyIn),
      valueInPositions: 0.0,
    });

    // Step 2: Create userToLobby entry (creator joins automatically)
    // FIX: Explicitly convert to float64 compatible values
    const userToLobbyId = await ctx.db.insert("userToLobby", {
      userId: user._id,
      lobbyId: lobbyId,
      walletAddress: walletAddress,
      balance: Number(args.buyIn),      // Ensure it's a number
      valueInPositions: 0.0,            // Use 0.0 not 0 for float64
    });

    console.log("UserToLobby created with ID:", userToLobbyId);

    return {
      lobbyId,
      name: args.name,
      userToLobbyId,
    };
  },
});