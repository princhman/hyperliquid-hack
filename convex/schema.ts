import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    walletAddress: v.string(),
    username: v.optional(v.string()),
    createdAt: v.number(),
    // Pear Protocol tokens
    pearAccessToken: v.optional(v.string()),
    pearRefreshToken: v.optional(v.string()),
    pearTokenExpiry: v.optional(v.number()),
    pearTokenExpiresAt: v.optional(v.number()), // Legacy field
    // Agent wallet
    agentWalletAddress: v.optional(v.string()),
    agentWalletStatus: v.optional(v.string()),
  })
    .index("by_wallet", ["walletAddress"])
    .index("by_username", ["username"]),

  sessions: defineTable({
    userId: v.id("users"),
    token: v.string(),
    expiresAt: v.number(),
  }).index("by_token", ["token"]),
});
