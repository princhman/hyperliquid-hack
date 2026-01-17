import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    walletAddress: v.string(),
    username: v.optional(v.string()),
    createdAt: v.number(),
    lastLoginAt: v.optional(v.number()),
    walletStatus: v.optional(
      v.union(
        v.literal("ACTIVE"),
        v.literal("EXPIRED"),
        v.literal("NOT_FOUND")
      )
    ),
  }).index("by_wallet", ["walletAddress"]),

  lobby: defineTable({
    name: v.string(),
    status: v.union(
      v.literal("not started"),
      v.literal("started"),
      v.literal("finished"),
    ),

    createdBy: v.id("users"),
    createdAt: v.number(),

    //config
    startTime: v.number(),
    endTime: v.number(),
    buyIn: v.number(),
    // split should be defined later
  }).index("by_status", ["status"]),

  userToLobby: defineTable({
    userId: v.id("users"),
    lobbyId: v.id("lobby"),
    walletAddress: v.string(),
    balance: v.float64(),
    valueInPositions: v.float64(),
    transactionId: v.optional(v.string()),
  }).index("by_lobbyId", ["lobbyId"]),

  balanceHistory: defineTable({
    userId: v.id("users"),
    lobbyId: v.id("lobby"),
    valueInPositions: v.float64(),
    balance: v.float64(),
    timestamp: v.number(),
  }),

  userToPositions: defineTable({
    userId: v.id("users"),
    lobbyId: v.id("lobby"),
    positionId: v.string(),
    state: v.union(v.literal("open"), v.literal("closed")),
    createdAt: v.number(),
  }),
});
