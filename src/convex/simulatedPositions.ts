import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Create a simulated position (for demo mode)
 */
export const createSimulatedPosition = mutation({
  args: {
    positionId: v.string(),
    address: v.string(),
    lobbyId: v.id("lobby"),
    longAsset: v.string(),
    shortAsset: v.string(),
    leverage: v.number(),
    usdValue: v.number(),
    entryPriceLong: v.number(),
    entryPriceShort: v.number(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("simulatedPositions", {
      ...args,
      address: args.address.toLowerCase(),
      createdAt: Date.now(),
    });
    return { id, positionId: args.positionId };
  },
});

/**
 * Get all simulated positions for an address
 */
export const getPositionsByAddress = query({
  args: {
    address: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("simulatedPositions")
      .withIndex("by_address", (q) => q.eq("address", args.address.toLowerCase()))
      .collect();
  },
});

/**
 * Get a simulated position by positionId
 */
export const getPositionById = query({
  args: {
    positionId: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("simulatedPositions")
      .withIndex("by_positionId", (q) => q.eq("positionId", args.positionId))
      .first();
  },
});

/**
 * Delete a simulated position
 */
export const deletePosition = mutation({
  args: {
    positionId: v.string(),
  },
  handler: async (ctx, args) => {
    const position = await ctx.db
      .query("simulatedPositions")
      .withIndex("by_positionId", (q) => q.eq("positionId", args.positionId))
      .first();

    if (position) {
      await ctx.db.delete(position._id);
      return { success: true, position };
    }
    return { success: false, position: null };
  },
});

/**
 * Delete all simulated positions for an address
 */
export const deleteAllPositionsForAddress = mutation({
  args: {
    address: v.string(),
  },
  handler: async (ctx, args) => {
    const positions = await ctx.db
      .query("simulatedPositions")
      .withIndex("by_address", (q) => q.eq("address", args.address.toLowerCase()))
      .collect();

    for (const position of positions) {
      await ctx.db.delete(position._id);
    }

    return { deletedCount: positions.length };
  },
});
