import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Login or register user by wallet address
 */
export const loginWithWallet = mutation({
  args: {
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    // Check if user exists
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();

    if (existingUser) {
      // Update last login time and set status to ACTIVE
      await ctx.db.patch(existingUser._id, {
        lastLoginAt: Date.now(),
        walletStatus: "ACTIVE",
      });
      return {
        walletAddress: existingUser.walletAddress,
        username: existingUser.username,
        walletStatus: "ACTIVE",
        isNewUser: false,
      };
    }

    // Create new user
    const userId = await ctx.db.insert("users", {
      walletAddress,
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
      walletStatus: "ACTIVE",
    });

    return {
      walletAddress,
      username: undefined,
      walletStatus: "ACTIVE",
      isNewUser: true,
    };
  },
});

/**
 * Update wallet status
 */
export const updateWalletStatus = mutation({
  args: {
    walletAddress: v.string(),
    status: v.union(
      v.literal("ACTIVE"),
      v.literal("EXPIRED"),
      v.literal("NOT_FOUND")
    ),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    const user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    await ctx.db.patch(user._id, {
      walletStatus: args.status,
    });

    return { success: true };
  },
});

/**
 * Get user by wallet address
 */
export const getUserByWallet = query({
  args: {
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    const user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();

    if (!user) {
      return null;
    }

    return {
      walletAddress: user.walletAddress,
      username: user.username,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      walletStatus: user.walletStatus ?? "NOT_FOUND",
    };
  },
});

/**
 * Check if user exists (for session validation)
 */
export const checkSession = query({
  args: {
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();

    const user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();

    return {
      isLoggedIn: !!user,
      walletAddress: user?.walletAddress ?? null,
    };
  },
});

/**
 * Update username for a user
 */
export const updateUsername = mutation({
  args: {
    walletAddress: v.string(),
    username: v.string(),
  },
  handler: async (ctx, args) => {
    const walletAddress = args.walletAddress.toLowerCase();
    const username = args.username;

    if (!username || username.length < 1) {
      throw new Error("Username cannot be empty");
    }

    if (username.length > 32) {
      throw new Error("Username must be 32 characters or less");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    await ctx.db.patch(user._id, {
      username: args.username,
    });

    return { success: true, username: args.username };
  },
});
