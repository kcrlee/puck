"use client";

import { Render } from "@/core";
import config from "../../config";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { PageDocument } from "@/core/crdt/PageDocument";
import { useMemo } from "react";
import * as Y from "yjs";

/**
 * Storefront render component.
 *
 * Reads published page content from Convex. The `content` field is
 * materialized JSON (no Yjs needed at read time). We reconstruct
 * Puck Data from the stored Y.Doc state for rendering.
 */
export function ConvexRender({
  path,
  metadata,
}: {
  path: string;
  metadata: Record<string, string>;
}) {
  const tenantId = "demo";

  // Read the Y.Doc state to reconstruct Puck Data for <Render>
  const publishedPage = useQuery(api.pages.getPublished, {
    tenantId,
    slug: path,
  });

  // Also fetch yjsState to get full Puck Data shape for <Render>
  // (the materialized `content` is a raw block structure, not Puck Data)
  const pageList = useQuery(api.pages.list, { tenantId });
  const pageEntry = pageList?.find((p) => p.slug === path);
  const yjsResult = useQuery(
    api.pages.getYjsState,
    pageEntry ? { pageId: pageEntry._id as any } : "skip"
  );

  const data = useMemo(() => {
    if (!yjsResult) return null;

    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, new Uint8Array(yjsResult.yjsState), "remote");
    const doc = new PageDocument(ydoc, config);
    const puckData = doc.toPuckData();
    doc.destroy();
    return puckData;
  }, [yjsResult]);

  if (!publishedPage) {
    return (
      <div
        style={{
          display: "flex",
          height: "100vh",
          textAlign: "center",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div>
          <h1>404</h1>
          <p>Page not published</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return <div>Loading...</div>;
  }

  return <Render config={config} data={data} metadata={metadata} />;
}
