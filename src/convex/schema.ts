import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    walletAddress: v.string(),
    username: v.optional(v.string()),
    createdAt: v.number(),

    // Pear Protocol auth tokens
    pearAccessToken: v.optional(v.string()),
    pearRefreshToken: v.optional(v.string()),
    pearTokenExpiresAt: v.optional(v.number()),

    // Agent wallet info (managed by Pear, we just store the address/status)
    agentWalletAddress: v.optional(v.string()),
    agentWalletStatus: v.optional(
      v.union(
        v.literal("ACTIVE"),
        v.literal("EXPIRED"),
        v.literal("NOT_FOUND"),
      ),
    ),
  }).index("by_wallet", ["walletAddress"]),

  sessions: defineTable({
    name: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("completed"),
    ),
    startTime: v.number(),
    endTime: v.number(),
    maxPlayers: v.number(),
    baseCapital: v.number(),
    createdBy: v.id("users"),
    rules: v.object({
      allowedPairs: v.array(v.string()),
      maxLeverage: v.number(),
    }),
    createdAt: v.number(),
  }).index("by_status", ["status"]),

  playerSessions: defineTable({
    userId: v.id("users"),
    sessionId: v.id("sessions"),
    walletAddress: v.string(),
    currentPnL: v.number(),
    finalPnL: v.optional(v.number()),
    rank: v.optional(v.number()),
    status: v.union(
      v.literal("active"),
      v.literal("disqualified"),
      v.literal("completed"),
    ),
    joinedAt: v.number(),
  })
    .index("by_session", ["sessionId"])
    .index("by_user", ["userId"]),
});
