import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    walletAddress: v.string(),
    username: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_wallet", ["walletAddress"]),

  lobby: defineTable({
    name: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),

    //config
    startTime: v.number(),
    endTime: v.number(),
    buyIn: v.number(),
    // split should be defined later
  }),

  userToLobby: defineTable({
    userId: v.id("users"),
    lobbyId: v.id("lobby"),
    walletAddress: v.string(),
    balance: v.float64(),
    valueInPositions: v.float64(),
    transactionId: v.optional(v.string()),
  }),

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
