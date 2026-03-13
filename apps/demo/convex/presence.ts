import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const PRESENCE_TTL_MS = 30_000; // 30 seconds — stale entries cleaned on read

/**
 * Update the calling user's presence state for a page.
 * Called periodically by the client (e.g., every 10s) and on selection change.
 */
export const update = mutation({
  args: {
    pageId: v.id("pages"),
    userId: v.string(),
    userName: v.string(),
    userColor: v.string(),
    selectedBlockId: v.optional(v.string()),
    activeField: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { pageId, userId, ...rest } = args;

    // Upsert: find existing presence for this user+page, or create
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_page_user", (q) =>
        q.eq("pageId", pageId).eq("userId", userId)
      )
      .first();

    const data = {
      pageId,
      userId,
      ...rest,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, data);
    } else {
      await ctx.db.insert("presence", data);
    }
  },
});

/**
 * Remove a user's presence (called on unmount / page leave).
 */
export const remove = mutation({
  args: {
    pageId: v.id("pages"),
    userId: v.string(),
  },
  handler: async (ctx, { pageId, userId }) => {
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_page_user", (q) =>
        q.eq("pageId", pageId).eq("userId", userId)
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

/**
 * Get all active users on a page. Filters out stale entries.
 */
export const getForPage = query({
  args: { pageId: v.id("pages") },
  handler: async (ctx, { pageId }) => {
    const entries = await ctx.db
      .query("presence")
      .withIndex("by_page", (q) => q.eq("pageId", pageId))
      .collect();

    const now = Date.now();
    return entries
      .filter((e) => now - e.updatedAt < PRESENCE_TTL_MS)
      .map(({ _id, _creationTime, ...rest }) => rest);
  },
});
