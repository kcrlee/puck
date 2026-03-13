import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  pages: defineTable({
    tenantId: v.string(),
    slug: v.string(),
    title: v.string(),
    content: v.any(), // materialized SerializedPage for storefront reads
    yjsState: v.bytes(), // binary Y.Doc state
    version: v.number(),
    status: v.union(v.literal("draft"), v.literal("published")),
    updatedAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_slug", ["tenantId", "slug"]),

  presence: defineTable({
    pageId: v.id("pages"),
    userId: v.string(),
    userName: v.string(),
    userColor: v.string(),
    selectedBlockId: v.optional(v.string()),
    activeField: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_page", ["pageId"])
    .index("by_page_user", ["pageId", "userId"]),
});
