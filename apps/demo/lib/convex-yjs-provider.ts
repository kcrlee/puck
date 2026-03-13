import * as Y from "yjs";
import type { ConvexReactClient } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

type YjsStateResult = FunctionReturnType<typeof api.pages.getYjsState>;

/**
 * Syncs a local Y.Doc with a Convex-stored page.
 *
 * - Local changes (origin !== 'remote') are sent to Convex via `syncUpdate` mutation.
 * - Remote changes are received via Convex reactive query and applied with origin 'remote'.
 * - Y.UndoManager's `trackedOrigins` filter ensures remote changes aren't undoable.
 */
export class ConvexYjsProvider {
  private unsubUpdate: (() => void) | null = null;
  private unsubQuery: (() => void) | null = null;
  private appliedVersion = -1;
  private destroyed = false;

  constructor(
    readonly ydoc: Y.Doc,
    private convex: ConvexReactClient,
    private pageId: Id<"pages">
  ) {
    // Send local changes to Convex
    const handleUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === "remote" || this.destroyed) return;

      this.convex.mutation(api.pages.syncUpdate, {
        pageId: this.pageId,
        update,
      });
    };

    ydoc.on("update", handleUpdate);
    this.unsubUpdate = () => ydoc.off("update", handleUpdate);

    // Subscribe to remote changes via Convex reactive query
    this.unsubQuery = this.convex.onUpdate(
      api.pages.getYjsState,
      { pageId: this.pageId },
      (result: YjsStateResult) => {
        if (this.destroyed) return;

        // Skip if we've already applied this version
        if (result.version <= this.appliedVersion) return;
        this.appliedVersion = result.version;

        Y.applyUpdate(this.ydoc, new Uint8Array(result.yjsState), "remote");
      }
    );
  }

  destroy() {
    this.destroyed = true;
    this.unsubUpdate?.();
    this.unsubQuery?.();
  }
}

/**
 * Initialize a Y.Doc from Convex page state.
 * Call this before constructing ConvexYjsProvider to populate initial state.
 */
export async function loadInitialState(
  convex: ConvexReactClient,
  pageId: Id<"pages">
): Promise<Y.Doc> {
  const result = await convex.query(api.pages.getYjsState, { pageId });

  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, new Uint8Array(result.yjsState), "remote");

  return ydoc;
}
