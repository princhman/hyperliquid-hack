import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Create a userToPositions record when a position is created
 * Also reduces the user's balance by the position cost
 */
export const createUserPosition = mutation({
  args: {
    userId: v.id("users"),
    lobbyId: v.id("lobby"),
    positionId: v.string(),
    positionCost: v.float64(),
  },
  handler: async (ctx, args) => {
    // Find userToLobby to update balance
    const userToLobby = await ctx.db
      .query("userToLobby")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), args.userId),
          q.eq(q.field("lobbyId"), args.lobbyId),
        ),
      )
      .first();

    if (!userToLobby) {
      throw new Error("User not in lobby");
    }

    if (userToLobby.balance < args.positionCost) {
      throw new Error("Insufficient balance");
    }

    // Reduce balance by position cost
    const newBalance = userToLobby.balance - args.positionCost;

    await ctx.db.patch(userToLobby._id, {
      balance: newBalance,
    });

    // Create the position record
    const id = await ctx.db.insert("userToPositions", {
      userId: args.userId,
      lobbyId: args.lobbyId,
      positionId: args.positionId,
      state: "open",
      createdAt: Date.now(),
    });

    // Record balance history
    await ctx.db.insert("balanceHistory", {
      userId: args.userId,
      lobbyId: args.lobbyId,
      balance: newBalance,
      valueInPositions: userToLobby.valueInPositions + args.positionCost,
      timestamp: Date.now(),
    });

    return {
      id,
      newBalance,
      positionCost: args.positionCost,
    };
  },
});

/**
 * Close a position: mark as closed and add realized value back to balance
 */
export const closeUserPosition = mutation({
  args: {
    positionId: v.string(),
    realizedValue: v.float64(),
  },
  handler: async (ctx, args) => {
    const position = await ctx.db
      .query("userToPositions")
      .filter((q) => q.eq(q.field("positionId"), args.positionId))
      .first();

    if (!position) {
      throw new Error("Position not found");
    }

    if (position.state === "closed") {
      return { success: true, alreadyClosed: true };
    }

    // Mark position as closed
    await ctx.db.patch(position._id, {
      state: "closed",
    });

    // Find userToLobby to update balance
    const userToLobby = await ctx.db
      .query("userToLobby")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), position.userId),
          q.eq(q.field("lobbyId"), position.lobbyId),
        ),
      )
      .first();

    if (!userToLobby) {
      throw new Error("User not in lobby");
    }

    // Add realized value back to balance
    const newBalance = userToLobby.balance + args.realizedValue;

    await ctx.db.patch(userToLobby._id, {
      balance: newBalance,
    });

    // Record balance history
    await ctx.db.insert("balanceHistory", {
      userId: position.userId,
      lobbyId: position.lobbyId,
      balance: newBalance,
      valueInPositions: userToLobby.valueInPositions,
      timestamp: Date.now(),
    });

    return {
      success: true,
      alreadyClosed: false,
      newBalance,
      realizedValue: args.realizedValue,
    };
  },
});

/**
 * Get all positions for a user in a lobby (optionally filter by state)
 */
export const getUserPositions = query({
  args: {
    userId: v.id("users"),
    lobbyId: v.id("lobby"),
    state: v.optional(v.union(v.literal("open"), v.literal("closed"))),
  },
  handler: async (ctx, args) => {
    let positions = await ctx.db
      .query("userToPositions")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), args.userId),
          q.eq(q.field("lobbyId"), args.lobbyId),
        ),
      )
      .collect();

    if (args.state) {
      positions = positions.filter((p) => p.state === args.state);
    }

    return positions;
  },
});

/**
 * Update valueInPositions for a user in a lobby and record balance history
 */
export const updateUserPositionValue = mutation({
  args: {
    userId: v.id("users"),
    lobbyId: v.id("lobby"),
    valueInPositions: v.float64(),
  },
  handler: async (ctx, args) => {
    const userToLobby = await ctx.db
      .query("userToLobby")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), args.userId),
          q.eq(q.field("lobbyId"), args.lobbyId),
        ),
      )
      .first();

    if (!userToLobby) {
      throw new Error("User not in lobby");
    }

    await ctx.db.patch(userToLobby._id, {
      valueInPositions: args.valueInPositions,
    });

    await ctx.db.insert("balanceHistory", {
      userId: args.userId,
      lobbyId: args.lobbyId,
      balance: userToLobby.balance,
      valueInPositions: args.valueInPositions,
      timestamp: Date.now(),
    });

    return {
      success: true,
      balance: userToLobby.balance,
      valueInPositions: args.valueInPositions,
      totalValue: userToLobby.balance + args.valueInPositions,
    };
  },
});

/**
 * Batch update position values for all users in a lobby based on position data
 * Called from WebSocket sync to update valueInPositions and record history
 */
export const syncPositionValues = mutation({
  args: {
    lobbyId: v.id("lobby"),
    positionValues: v.array(
      v.object({
        positionId: v.string(),
        positionValue: v.float64(),
        unrealizedPnl: v.float64(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    // Get all open positions for this lobby
    const userPositions = await ctx.db
      .query("userToPositions")
      .filter((q) =>
        q.and(
          q.eq(q.field("lobbyId"), args.lobbyId),
          q.eq(q.field("state"), "open"),
        ),
      )
      .collect();

    // Create a map of positionId to value data
    const positionValueMap = new Map(
      args.positionValues.map((pv) => [pv.positionId, pv]),
    );

    // Group positions by userId and calculate total value
    const userValueMap = new Map<string, number>();

    for (const userPos of userPositions) {
      const valueData = positionValueMap.get(userPos.positionId);
      if (valueData) {
        const currentValue = userValueMap.get(userPos.userId) || 0;
        userValueMap.set(
          userPos.userId,
          currentValue + valueData.positionValue + valueData.unrealizedPnl,
        );
      }
    }

    // Update each user's valueInPositions and record balance history
    const results = [];
    for (const [userId, totalPositionValue] of userValueMap) {
      const userToLobby = await ctx.db
        .query("userToLobby")
        .filter((q) =>
          q.and(
            q.eq(q.field("userId"), userId),
            q.eq(q.field("lobbyId"), args.lobbyId),
          ),
        )
        .first();

      if (userToLobby) {
        await ctx.db.patch(userToLobby._id, {
          valueInPositions: totalPositionValue,
        });

        await ctx.db.insert("balanceHistory", {
          userId: userId as any,
          lobbyId: args.lobbyId,
          balance: userToLobby.balance,
          valueInPositions: totalPositionValue,
          timestamp: Date.now(),
        });

        results.push({
          userId,
          balance: userToLobby.balance,
          valueInPositions: totalPositionValue,
          totalValue: userToLobby.balance + totalPositionValue,
        });
      }
    }

    return results;
  },
});
