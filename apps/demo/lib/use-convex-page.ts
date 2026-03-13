"use client";

import { useEffect, useState, useRef } from "react";
import * as Y from "yjs";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { ConvexYjsProvider } from "./convex-yjs-provider";
import { PageDocument } from "@/core/crdt/PageDocument";
import type { Config, Data } from "@/core";

/**
 * Hook that manages the Y.Doc ↔ Convex sync lifecycle for a page.
 *
 * Returns { pageDocument, isLoading, pageId } for wiring into <Puck>.
 * The PageDocument's Y.Doc is synced with Convex in real-time.
 */
export function useConvexPage({
  tenantId,
  slug,
  config,
  initialData,
}: {
  tenantId: string;
  slug: string;
  config: Config;
  initialData: Data;
}) {
  const convex = useConvex();

  // Look up existing page or create one
  const existingPage = useQuery(api.pages.getPublished, { tenantId, slug });
  const createPage = useMutation(api.pages.create);

  const [pageId, setPageId] = useState<Id<"pages"> | null>(null);
  const [pageDocument, setPageDocument] = useState<PageDocument | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const providerRef = useRef<ConvexYjsProvider | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      let resolvedPageId: Id<"pages">;

      // Try to find existing page by querying yjsState
      try {
        const result = await convex.query(api.pages.list, { tenantId });
        const existing = result.find((p) => p.slug === slug);

        if (existing) {
          resolvedPageId = existing._id as Id<"pages">;
        } else {
          // Create new page from initial data
          const doc = PageDocument.fromPuckData(initialData, config);
          const yjsState = Y.encodeStateAsUpdate(doc.ydoc);
          doc.destroy();

          resolvedPageId = await createPage({
            tenantId,
            slug,
            title: (initialData.root as any)?.props?.title || slug,
            initialYjsState: yjsState,
          });
        }
      } catch {
        // If list query fails (e.g., first run), create the page
        const doc = PageDocument.fromPuckData(initialData, config);
        const yjsState = Y.encodeStateAsUpdate(doc.ydoc);
        doc.destroy();

        resolvedPageId = await createPage({
          tenantId,
          slug,
          title: (initialData.root as any)?.props?.title || slug,
          initialYjsState: yjsState,
        });
      }

      if (cancelled) return;

      // Load Y.Doc state from Convex
      const result = await convex.query(api.pages.getYjsState, {
        pageId: resolvedPageId,
      });

      if (cancelled) return;

      const ydoc = new Y.Doc();
      Y.applyUpdate(ydoc, new Uint8Array(result.yjsState), "remote");

      const doc = new PageDocument(ydoc, config);

      // Start real-time sync
      const provider = new ConvexYjsProvider(ydoc, convex, resolvedPageId);
      providerRef.current = provider;

      setPageId(resolvedPageId);
      setPageDocument(doc);
      setIsLoading(false);
    }

    init();

    return () => {
      cancelled = true;
      providerRef.current?.destroy();
      providerRef.current = null;
    };
  }, [tenantId, slug]);

  return { pageDocument, pageId, isLoading };
}
