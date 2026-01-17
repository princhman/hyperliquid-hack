import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Get user by wallet address
 */
export const getUserByWallet = query({
  args: {
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const normalizedAddress = args.walletAddress.toLowerCase();
    return await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", normalizedAddress))
      .first();
  },
});

/**
 * Create a new user with wallet address
 */
export const createUser = mutation({
  args: {
    walletAddress: v.string(),
    username: v.string(),
  },
  handler: async (ctx, args) => {
    const normalizedAddress = args.walletAddress.toLowerCase();

    // Check if user already exists
    const existing = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", normalizedAddress))
      .first();

    if (existing) {
      throw new Error("User already exists");
    }

    const id = await ctx.db.insert("users", {
      walletAddress: normalizedAddress,
      username: args.username,
      createdAt: Date.now(),
    });

    return { id, walletAddress: normalizedAddress, username: args.username };
  },
});

/**
 * Update username for existing user
 */
export const updateUsername = mutation({
  args: {
    walletAddress: v.string(),
    username: v.string(),
  },
  handler: async (ctx, args) => {
    const normalizedAddress = args.walletAddress.toLowerCase();

    const user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", normalizedAddress))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    await ctx.db.patch(user._id, {
      username: args.username,
    });

    return { success: true };
  },
});
