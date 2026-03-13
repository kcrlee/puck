import { internalMutation } from "./_generated/server";
import * as Y from "yjs";

const COMPACTION_THRESHOLD = 5_000_000; // 5MB

/**
 * Re-encode Y.Doc state to strip accumulated change history.
 * Scheduled by crons.ts to run nightly.
 */
export const compactYjsState = internalMutation({
  handler: async (ctx) => {
    const pages = await ctx.db.query("pages").collect();

    let compacted = 0;

    for (const page of pages) {
      const state = new Uint8Array(page.yjsState);
      if (state.byteLength > COMPACTION_THRESHOLD) {
        const ydoc = new Y.Doc();
        Y.applyUpdate(ydoc, state);
        const fresh = Y.encodeStateAsUpdate(ydoc);
        ydoc.destroy();

        await ctx.db.patch(page._id, { yjsState: fresh });
        compacted++;
      }
    }

    if (compacted > 0) {
      console.log(`Compacted ${compacted} page(s)`);
    }
  },
});
