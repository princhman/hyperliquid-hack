import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Get or create a user by wallet address
 */
export const getOrCreateUser = mutation({
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
      return existingUser._id;
    }

    // Create new user
    const userId = await ctx.db.insert("users", {
      walletAddress,
      createdAt: Date.now(),
    });

    return userId;
  },
});

/**
 * Store Pear Protocol tokens after successful authentication
 */
export const storePearTokens = mutation({
  args: {
    walletAddress: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresIn: v.number(), // seconds until expiry
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

    // Calculate expiry timestamp (expiresIn is in seconds)
    const expiresAt = Date.now() + args.expiresIn * 1000;

    await ctx.db.patch(user._id, {
      pearAccessToken: args.accessToken,
      pearRefreshToken: args.refreshToken,
      pearTokenExpiresAt: expiresAt,
    });

    return { success: true };
  },
});

/**
 * Update tokens after refresh
 */
export const refreshPearTokens = mutation({
  args: {
    walletAddress: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresIn: v.number(),
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

    const expiresAt = Date.now() + args.expiresIn * 1000;

    await ctx.db.patch(user._id, {
      pearAccessToken: args.accessToken,
      pearRefreshToken: args.refreshToken,
      pearTokenExpiresAt: expiresAt,
    });

    return { success: true };
  },
});

/**
 * Store agent wallet info
 */
export const storeAgentWallet = mutation({
  args: {
    walletAddress: v.string(),
    agentWalletAddress: v.string(),
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
      agentWalletAddress: args.agentWalletAddress,
      agentWalletStatus: args.status,
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

    // Check if token is expired
    const isTokenExpired =
      !user.pearTokenExpiresAt || user.pearTokenExpiresAt < Date.now();

    return {
      id: user._id,
      walletAddress: user.walletAddress,
      username: user.username,
      isAuthenticated: !!user.pearAccessToken && !isTokenExpired,
      needsTokenRefresh: !!user.pearRefreshToken && isTokenExpired,
      agentWalletStatus: user.agentWalletStatus ?? "NOT_FOUND",
      agentWalletAddress: user.agentWalletAddress,
    };
  },
});

/**
 * Get stored tokens for API calls (only use server-side)
 */
export const getPearTokens = query({
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
      accessToken: user.pearAccessToken,
      refreshToken: user.pearRefreshToken,
      expiresAt: user.pearTokenExpiresAt,
      isExpired:
        !user.pearTokenExpiresAt || user.pearTokenExpiresAt < Date.now(),
    };
  },
});

/**
 * Clear tokens on logout
 */
export const logout = mutation({
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
      return { success: false };
    }

    await ctx.db.patch(user._id, {
      pearAccessToken: undefined,
      pearRefreshToken: undefined,
      pearTokenExpiresAt: undefined,
    });

    return { success: true };
  },
});
