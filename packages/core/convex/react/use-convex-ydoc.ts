"use client";

import { useEffect, useState, useRef } from "react";
import * as Y from "yjs";
import type { ConvexReactClient } from "convex/react";
import type { FunctionReference } from "convex/server";
import { PageDocument } from "../../crdt/PageDocument";
import { ConvexYjsProvider } from "../convex-yjs-provider";
import type { Config, Data } from "../../types";

export interface UseConvexYDocOptions {
  convex: ConvexReactClient;
  documentId: string | null;
  config: Config;
  syncMutation: FunctionReference<"mutation", "public">;
  stateQuery: FunctionReference<"query", "public">;
  initialData?: Data;
  documentIdField?: string;
  /** Extract bootstrap Data from the stateQuery result when yjsState is absent. */
  resolveInitialData?: (queryResult: any) => Data | undefined;
}

/**
 * Hook that manages the Y.Doc ↔ Convex sync lifecycle for a document.
 *
 * Loads initial Y.Doc state from Convex, creates a PageDocument, and sets up
 * bidirectional real-time sync. If no yjsState exists on the server and
 * initialData is provided, bootstraps the Y.Doc from that data.
 */
export function useConvexYDoc(opts: UseConvexYDocOptions): {
  pageDocument: PageDocument | null;
  isLoading: boolean;
} {
  const {
    convex,
    documentId,
    config,
    syncMutation,
    stateQuery,
    initialData,
    documentIdField = "pageId",
    resolveInitialData,
  } = opts;

  const [pageDocument, setPageDocument] = useState<PageDocument | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const providerRef = useRef<ConvexYjsProvider | null>(null);

  useEffect(() => {
    if (!documentId) return;

    let cancelled = false;

    async function init() {
      const result = await convex.query(stateQuery, {
        [documentIdField]: documentId,
      } as any);

      if (cancelled) return;

      const ydoc = new Y.Doc();

      // Track the version we loaded so the provider skips stale query results
      const initialVersion: number = result?.version ?? 0;

      if (result?.yjsState && result.yjsState.byteLength > 0) {
        Y.applyUpdate(ydoc, new Uint8Array(result.yjsState), "remote");
      } else {
        // No yjsState yet — bootstrap from query result or static initialData
        const bootstrapData =
          resolveInitialData?.(result) ?? initialData;
        if (bootstrapData) {
          const bootstrapDoc = PageDocument.fromPuckData(
            bootstrapData,
            config
          );
          const state = Y.encodeStateAsUpdate(bootstrapDoc.ydoc);
          bootstrapDoc.destroy();
          Y.applyUpdate(ydoc, state, "remote");
        }
      }

      if (cancelled) {
        ydoc.destroy();
        return;
      }

      const doc = new PageDocument(ydoc, config);

      const provider = new ConvexYjsProvider(ydoc, convex, {
        syncMutation,
        stateQuery,
        documentId: documentId!,
        documentIdField,
        initialVersion,
      });
      providerRef.current = provider;

      setPageDocument(doc);
      setIsLoading(false);
    }

    init();

    return () => {
      cancelled = true;
      providerRef.current?.destroy();
      providerRef.current = null;
      setPageDocument(null);
      setIsLoading(true);
    };
  }, [documentId]);

  return { pageDocument, isLoading };
}
