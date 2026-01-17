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

  // Trading competition games
  games: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    creatorId: v.id("users"),
    status: v.string(), // "waiting" | "active" | "finished"
    maxPlayers: v.number(),
    startingCapital: v.number(), // Starting capital for each player (notional)
    prizePool: v.number(),
    durationMinutes: v.number(),
    tradingPairs: v.array(v.string()), // e.g., ["BTC-PERP", "ETH-PERP"]
    startedAt: v.optional(v.number()),
    endsAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_creator", ["creatorId"]),

  // Players in games
  gameParticipants: defineTable({
    gameId: v.id("games"),
    userId: v.id("users"),
    joinedAt: v.number(),
    currentPnL: v.number(), // Current profit/loss
    totalTrades: v.number(),
    isActive: v.boolean(),
  })
    .index("by_game", ["gameId"])
    .index("by_user", ["userId"])
    .index("by_game_and_user", ["gameId", "userId"]),

  // Trade history for games
  gameTrades: defineTable({
    gameId: v.id("games"),
    participantId: v.id("gameParticipants"),
    userId: v.id("users"),
    pair: v.string(),
    side: v.string(), // "long" | "short"
    size: v.number(),
    entryPrice: v.number(),
    exitPrice: v.optional(v.number()),
    pnl: v.optional(v.number()),
    status: v.string(), // "open" | "closed"
    openedAt: v.number(),
    closedAt: v.optional(v.number()),
  })
    .index("by_game", ["gameId"])
    .index("by_participant", ["participantId"])
    .index("by_user", ["userId"]),
});
