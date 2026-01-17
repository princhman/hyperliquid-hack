import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    walletAddress: v.string(),
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
});
