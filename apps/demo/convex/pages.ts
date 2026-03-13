import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import * as Y from "yjs";

/**
 * Apply a Y.Doc update delta from a client.
 * Merges with stored state and materializes content for storefront reads.
 */
export const syncUpdate = mutation({
  args: {
    pageId: v.id("pages"),
    update: v.bytes(),
  },
  handler: async (ctx, { pageId, update }) => {
    const page = await ctx.db.get(pageId);
    if (!page) throw new ConvexError("Page not found");

    // Merge incoming Yjs delta with stored state
    const merged = Y.mergeUpdates([
      new Uint8Array(page.yjsState),
      new Uint8Array(update),
    ]);

    // Materialize for storefront reads
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, merged);
    const content = materializeContent(ydoc);
    ydoc.destroy();

    await ctx.db.patch(pageId, {
      yjsState: merged,
      content,
      version: page.version + 1,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Get the current Y.Doc state for a page.
 * Used by ConvexYjsProvider to initialize and subscribe to remote changes.
 */
export const getYjsState = query({
  args: { pageId: v.id("pages") },
  handler: async (ctx, { pageId }) => {
    const page = await ctx.db.get(pageId);
    if (!page) throw new ConvexError("Page not found");
    return { yjsState: page.yjsState, version: page.version };
  },
});

/**
 * Get a published page's materialized content (no Yjs needed).
 */
export const getPublished = query({
  args: { tenantId: v.string(), slug: v.string() },
  handler: async (ctx, { tenantId, slug }) => {
    const page = await ctx.db
      .query("pages")
      .withIndex("by_tenant_slug", (q) =>
        q.eq("tenantId", tenantId).eq("slug", slug)
      )
      .first();

    if (!page || page.status !== "published") return null;
    return { content: page.content, title: page.title };
  },
});

/**
 * Create a new page with initial Y.Doc state.
 */
export const create = mutation({
  args: {
    tenantId: v.string(),
    slug: v.string(),
    title: v.string(),
    initialYjsState: v.bytes(),
  },
  handler: async (ctx, { tenantId, slug, title, initialYjsState }) => {
    // Materialize initial content
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, new Uint8Array(initialYjsState));
    const content = materializeContent(ydoc);
    ydoc.destroy();

    return await ctx.db.insert("pages", {
      tenantId,
      slug,
      title,
      content,
      yjsState: initialYjsState,
      version: 1,
      status: "draft",
      updatedAt: Date.now(),
    });
  },
});

/**
 * Publish a page (set status to 'published').
 */
export const publish = mutation({
  args: { pageId: v.id("pages") },
  handler: async (ctx, { pageId }) => {
    const page = await ctx.db.get(pageId);
    if (!page) throw new ConvexError("Page not found");

    // Re-materialize content at publish time
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, new Uint8Array(page.yjsState));
    const content = materializeContent(ydoc);
    ydoc.destroy();

    await ctx.db.patch(pageId, {
      status: "published",
      content,
      updatedAt: Date.now(),
    });
  },
});

/**
 * List pages for a tenant.
 */
export const list = query({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) => {
    const pages = await ctx.db
      .query("pages")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();

    return pages.map(({ yjsState: _, ...page }) => page);
  },
});

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Materialize a Y.Doc into plain JSON content for storefront reads.
 * This is a simplified serialization — the full PageDocument.toJSON()
 * is in the core package but we can't import it in the Convex runtime.
 * Instead we read the raw Y.Doc shared types.
 */
function materializeContent(ydoc: Y.Doc): Record<string, unknown> {
  const blocks = ydoc.getMap("blocks");
  const rootBlocks = ydoc.getArray<string>("rootBlocks");
  const rootProps = ydoc.getMap("root");
  const meta = ydoc.getMap("meta");

  return {
    blocks: blocks.toJSON(),
    rootBlockIds: rootBlocks.toArray(),
    rootProps: rootProps.toJSON(),
    meta: meta.toJSON(),
  };
}
