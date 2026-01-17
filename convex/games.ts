import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// List all available games
export const listGames = query({
  args: {
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let gamesQuery = ctx.db.query("games");

    if (args.status) {
      gamesQuery = gamesQuery.withIndex("by_status", (q) =>
        q.eq("status", args.status!)
      );
    }

    const games = await gamesQuery.collect();

    // Get participant counts for each game
    const gamesWithParticipants = await Promise.all(
      games.map(async (game) => {
        const participants = await ctx.db
          .query("gameParticipants")
          .withIndex("by_game", (q) => q.eq("gameId", game._id))
          .collect();

        const creator = await ctx.db.get(game.creatorId);

        return {
          ...game,
          participantCount: participants.length,
          creatorName: creator?.username || creator?.walletAddress.slice(0, 8),
        };
      })
    );

    return gamesWithParticipants;
  },
});

// Get a single game with full details
export const getGame = query({
  args: {
    gameId: v.id("games"),
  },
  handler: async (ctx, args) => {
    const game = await ctx.db.get(args.gameId);
    if (!game) return null;

    const participants = await ctx.db
      .query("gameParticipants")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .collect();

    // Get user details for each participant
    const participantsWithDetails = await Promise.all(
      participants.map(async (p) => {
        const user = await ctx.db.get(p.userId);
        return {
          ...p,
          username: user?.username || user?.walletAddress.slice(0, 8),
          walletAddress: user?.walletAddress,
        };
      })
    );

    // Sort by PnL
    participantsWithDetails.sort((a, b) => b.currentPnL - a.currentPnL);

    const creator = await ctx.db.get(game.creatorId);

    return {
      ...game,
      participants: participantsWithDetails,
      creatorName: creator?.username || creator?.walletAddress.slice(0, 8),
    };
  },
});

// Create a new game
export const createGame = mutation({
  args: {
    walletAddress: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    maxPlayers: v.number(),
    startingCapital: v.number(),
    prizePool: v.number(),
    durationMinutes: v.number(),
    tradingPairs: v.array(v.string()),
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

    const gameId = await ctx.db.insert("games", {
      name: args.name,
      description: args.description,
      creatorId: user._id,
      status: "waiting",
      maxPlayers: args.maxPlayers,
      startingCapital: args.startingCapital,
      prizePool: args.prizePool,
      durationMinutes: args.durationMinutes,
      tradingPairs: args.tradingPairs,
      createdAt: Date.now(),
    });

    // Creator automatically joins the game
    await ctx.db.insert("gameParticipants", {
      gameId,
      userId: user._id,
      joinedAt: Date.now(),
      currentPnL: 0,
      totalTrades: 0,
      isActive: true,
    });

    return { gameId };
  },
});

// Join a game
export const joinGame = mutation({
  args: {
    walletAddress: v.string(),
    gameId: v.id("games"),
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

    const game = await ctx.db.get(args.gameId);
    if (!game) {
      throw new Error("Game not found");
    }

    if (game.status !== "waiting") {
      throw new Error("Game has already started or finished");
    }

    // Check if already joined
    const existingParticipant = await ctx.db
      .query("gameParticipants")
      .withIndex("by_game_and_user", (q) =>
        q.eq("gameId", args.gameId).eq("userId", user._id)
      )
      .first();

    if (existingParticipant) {
      throw new Error("Already joined this game");
    }

    // Check if game is full
    const participants = await ctx.db
      .query("gameParticipants")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .collect();

    if (participants.length >= game.maxPlayers) {
      throw new Error("Game is full");
    }

    await ctx.db.insert("gameParticipants", {
      gameId: args.gameId,
      userId: user._id,
      joinedAt: Date.now(),
      currentPnL: 0,
      totalTrades: 0,
      isActive: true,
    });

    return { success: true };
  },
});

// Leave a game (only if not started)
export const leaveGame = mutation({
  args: {
    walletAddress: v.string(),
    gameId: v.id("games"),
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

    const game = await ctx.db.get(args.gameId);
    if (!game) {
      throw new Error("Game not found");
    }

    if (game.status !== "waiting") {
      throw new Error("Cannot leave a game that has started");
    }

    const participant = await ctx.db
      .query("gameParticipants")
      .withIndex("by_game_and_user", (q) =>
        q.eq("gameId", args.gameId).eq("userId", user._id)
      )
      .first();

    if (!participant) {
      throw new Error("Not in this game");
    }

    await ctx.db.delete(participant._id);

    return { success: true };
  },
});

// Start a game (only creator can start)
export const startGame = mutation({
  args: {
    walletAddress: v.string(),
    gameId: v.id("games"),
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

    const game = await ctx.db.get(args.gameId);
    if (!game) {
      throw new Error("Game not found");
    }

    if (game.creatorId !== user._id) {
      throw new Error("Only the creator can start the game");
    }

    if (game.status !== "waiting") {
      throw new Error("Game has already started");
    }

    const participants = await ctx.db
      .query("gameParticipants")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .collect();

    if (participants.length < 1) {
      throw new Error("Need at least 1 player to start");
    }

    const now = Date.now();
    await ctx.db.patch(args.gameId, {
      status: "active",
      startedAt: now,
      endsAt: now + game.durationMinutes * 60 * 1000,
    });

    return { success: true };
  },
});

// Update participant PnL (called when trades are executed)
export const updateParticipantPnL = mutation({
  args: {
    gameId: v.id("games"),
    walletAddress: v.string(),
    pnlDelta: v.number(),
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

    const participant = await ctx.db
      .query("gameParticipants")
      .withIndex("by_game_and_user", (q) =>
        q.eq("gameId", args.gameId).eq("userId", user._id)
      )
      .first();

    if (!participant) {
      throw new Error("Not a participant in this game");
    }

    await ctx.db.patch(participant._id, {
      currentPnL: participant.currentPnL + args.pnlDelta,
      totalTrades: participant.totalTrades + 1,
    });

    return { success: true };
  },
});

// Get leaderboard for a game
export const getLeaderboard = query({
  args: {
    gameId: v.id("games"),
  },
  handler: async (ctx, args) => {
    const participants = await ctx.db
      .query("gameParticipants")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .collect();

    const leaderboard = await Promise.all(
      participants.map(async (p) => {
        const user = await ctx.db.get(p.userId);
        return {
          participantId: p._id,
          userId: p.userId,
          username: user?.username || user?.walletAddress.slice(0, 8),
          walletAddress: user?.walletAddress,
          pnl: p.currentPnL,
          totalTrades: p.totalTrades,
        };
      })
    );

    // Sort by PnL descending
    leaderboard.sort((a, b) => b.pnl - a.pnl);

    return leaderboard;
  },
});

// Get user's active games
export const getUserGames = query({
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
      return [];
    }

    const participations = await ctx.db
      .query("gameParticipants")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const games = await Promise.all(
      participations.map(async (p) => {
        const game = await ctx.db.get(p.gameId);
        if (!game) return null;

        const allParticipants = await ctx.db
          .query("gameParticipants")
          .withIndex("by_game", (q) => q.eq("gameId", p.gameId))
          .collect();

        return {
          ...game,
          participantCount: allParticipants.length,
          myPnL: p.currentPnL,
          myTrades: p.totalTrades,
        };
      })
    );

    return games.filter((g) => g !== null);
  },
});
