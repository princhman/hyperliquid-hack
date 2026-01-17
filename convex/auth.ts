import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

function generateToken(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Get or create user by wallet address
export const getOrCreateUser = mutation({
  args: {
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const normalizedAddress = args.walletAddress.toLowerCase();

    // Check if user exists
    let user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", normalizedAddress))
      .first();

    if (!user) {
      // Create new user
      const userId = await ctx.db.insert("users", {
        walletAddress: normalizedAddress,
        createdAt: Date.now(),
      });
      user = await ctx.db.get(userId);
    }

    // Create session
    const token = generateToken();
    await ctx.db.insert("auth_sessions", {
      userId: user!._id,
      token,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return {
      userId: user!._id,
      token,
      user: {
        walletAddress: user!.walletAddress,
        username: user!.username,
      },
    };
  },
});

// Store Pear Protocol tokens
export const storePearTokens = mutation({
  args: {
    walletAddress: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresIn: v.number(),
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
      pearAccessToken: args.accessToken,
      pearRefreshToken: args.refreshToken,
      pearTokenExpiry: Date.now() + args.expiresIn * 1000,
    });

    return { success: true };
  },
});

// Store agent wallet info
export const storeAgentWallet = mutation({
  args: {
    walletAddress: v.string(),
    agentWalletAddress: v.string(),
    status: v.string(),
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
      agentWalletAddress: args.agentWalletAddress,
      agentWalletStatus: args.status,
    });

    return { success: true };
  },
});

// Update username
export const updateUsername = mutation({
  args: {
    token: v.string(),
    username: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate username
    const trimmedUsername = args.username.trim();
    if (trimmedUsername.length < 3 || trimmedUsername.length > 20) {
      throw new Error("Username must be between 3 and 20 characters");
    }

    if (!/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
      throw new Error("Username can only contain letters, numbers, and underscores");
    }

    // Check session
    const session = await ctx.db
      .query("auth_sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      throw new Error("Not authenticated");
    }

    // Check if username is already taken
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", trimmedUsername.toLowerCase()))
      .first();

    if (existingUser && existingUser._id !== session.userId) {
      throw new Error("Username is already taken");
    }

    // Update username
    await ctx.db.patch(session.userId, {
      username: trimmedUsername.toLowerCase(),
    });

    return { success: true, username: trimmedUsername.toLowerCase() };
  },
});

// Get current user
export const getMe = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("auth_sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      return null;
    }

    const user = await ctx.db.get(session.userId);
    if (!user) {
      return null;
    }

    return {
      id: user._id,
      walletAddress: user.walletAddress,
      username: user.username,
      agentWalletAddress: user.agentWalletAddress,
      agentWalletStatus: user.agentWalletStatus,
    };
  },
});

// Get user by wallet address
export const getUserByWallet = query({
  args: {
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const normalizedAddress = args.walletAddress.toLowerCase();

    const user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", normalizedAddress))
      .first();

    if (!user) {
      return null;
    }

    return {
      id: user._id,
      walletAddress: user.walletAddress,
      username: user.username,
    };
  },
});

// Update username by wallet address (for wallet-based auth)
export const updateUsernameByWallet = mutation({
  args: {
    walletAddress: v.string(),
    username: v.string(),
  },
  handler: async (ctx, args) => {
    const normalizedAddress = args.walletAddress.toLowerCase();

    // Validate username
    const trimmedUsername = args.username.trim();
    if (trimmedUsername.length < 3 || trimmedUsername.length > 20) {
      throw new Error("Username must be between 3 and 20 characters");
    }

    if (!/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
      throw new Error("Username can only contain letters, numbers, and underscores");
    }

    // Find user by wallet
    const user = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", normalizedAddress))
      .first();

    if (!user) {
      throw new Error("User not found. Please connect your wallet first.");
    }

    // Check if username is already taken by another user
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", trimmedUsername.toLowerCase()))
      .first();

    if (existingUser && existingUser._id !== user._id) {
      throw new Error("Username is already taken");
    }

    // Update username
    await ctx.db.patch(user._id, {
      username: trimmedUsername.toLowerCase(),
    });

    return { success: true, username: trimmedUsername.toLowerCase() };
  },
});

// Logout
export const logout = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("auth_sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (session) {
      await ctx.db.delete(session._id);
    }

    return { success: true };
  },
});
