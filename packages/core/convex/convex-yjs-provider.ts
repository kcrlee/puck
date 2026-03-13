import * as Y from "yjs";
import type { ConvexReactClient } from "convex/react";
import type { FunctionReference } from "convex/server";

export interface ConvexYjsProviderOptions {
  syncMutation: FunctionReference<"mutation", "public">;
  stateQuery: FunctionReference<"query", "public">;
  documentId: string;
  documentIdField?: string;
  /** Version already applied during initial load — skip query results at or below this. */
  initialVersion?: number;
  /** Optional callback to provide extra args (e.g. materialized puckData) sent with each sync mutation. */
  getMutationExtras?: () => Record<string, unknown>;
}

/**
 * Syncs a local Y.Doc with a Convex-stored document.
 *
 * - Local changes (origin !== 'remote') are sent to Convex via syncMutation.
 * - Remote changes are received via Convex reactive query and applied with origin 'remote'.
 * - Y.UndoManager's trackedOrigins filter ensures remote changes aren't undoable.
 */
export class ConvexYjsProvider {
  private unsubUpdate: (() => void) | null = null;
  private unsubQuery: (() => void) | null = null;
  private appliedVersion: number;
  private destroyed = false;

  constructor(
    readonly ydoc: Y.Doc,
    private convex: ConvexReactClient,
    private opts: ConvexYjsProviderOptions
  ) {
    const idField = opts.documentIdField ?? "pageId";
    this.appliedVersion = opts.initialVersion ?? -1;

    // Send local changes to Convex
    const handleUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === "remote" || this.destroyed) return;

      const extras = opts.getMutationExtras?.() ?? {};
      // Yjs emits Uint8Array but Convex v.bytes() expects ArrayBuffer
      const buf = update.buffer.slice(
        update.byteOffset,
        update.byteOffset + update.byteLength
      );
      this.convex.mutation(opts.syncMutation, {
        [idField]: opts.documentId,
        update: buf,
        ...extras,
      } as any);
    };

    ydoc.on("update", handleUpdate);
    this.unsubUpdate = () => ydoc.off("update", handleUpdate);

    // Subscribe to remote changes via Convex reactive query
    const watch = this.convex.watchQuery(opts.stateQuery, {
      [idField]: opts.documentId,
    } as any);

    this.unsubQuery = watch.onUpdate(() => {
      if (this.destroyed) return;

      const result = watch.localQueryResult() as
        | { yjsState: ArrayBuffer | null; version: number }
        | undefined
        | null;
      if (!result) return;

      if (result.version <= this.appliedVersion) return;
      if (!result.yjsState || result.yjsState.byteLength === 0) return;

      this.appliedVersion = result.version;
      Y.applyUpdate(this.ydoc, new Uint8Array(result.yjsState), "remote");
    });
  }

  destroy() {
    this.destroyed = true;
    this.unsubUpdate?.();
    this.unsubQuery?.();
  }
}
