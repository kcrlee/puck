"use client";

import { AutoField, Button, FieldLabel, Puck, createUsePuck } from "@/core";
import headingAnalyzer from "@/plugin-heading-analyzer/src/HeadingAnalyzer";
import config from "../../config";
import { initialData } from "../../config/initial-data";
import { useConvexPage } from "../../lib/use-convex-page";
import { usePresence } from "../../lib/use-presence";
import { PresenceOverlay, PresenceAvatars } from "../../lib/presence-overlay";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Type } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

const usePuck = createUsePuck();

// Generate a stable anonymous user ID per browser session
function getSessionUserId(): string {
  const key = "puck-presence-user-id";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = `user-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(key, id);
  }
  return id;
}

/**
 * Convex-synced Puck editor with real-time presence.
 *
 * The Y.Doc is loaded from Convex and kept in sync via ConvexYjsProvider.
 * Edits are automatically persisted — no manual save needed.
 * "Publish" sets the page status to 'published' for storefront reads.
 */
export function ConvexEditor({
  path,
  metadata,
}: {
  path: string;
  metadata: Record<string, string>;
}) {
  const tenantId = "demo"; // In production, derive from auth
  const userId = useMemo(() => getSessionUserId(), []);
  const userName = useMemo(() => `User ${userId.slice(-4)}`, [userId]);

  const { pageDocument, pageId, isLoading } = useConvexPage({
    tenantId,
    slug: path,
    config,
    initialData: initialData[path] || { content: [], root: { props: {} } },
  });

  const { others, sendUpdate } = usePresence({
    pageId,
    userId,
    userName,
  });

  const publishPage = useMutation(api.pages.publish);

  if (isLoading || !pageDocument || !pageId) {
    return (
      <div
        style={{
          display: "flex",
          height: "100vh",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        Loading editor...
      </div>
    );
  }

  const data = pageDocument.toPuckData();
  const params = new URL(window.location.href).searchParams;

  return (
    <div>
      <Puck
        config={config}
        data={data}
        onPublish={async () => {
          await publishPage({ pageId });
        }}
        onChange={() => {
          // Noop — Convex sync handles persistence via Y.Doc updates.
          // onChange is required to trigger Puck's internal data flow.
        }}
        plugins={[headingAnalyzer]}
        headerPath={path}
        iframe={{
          enabled: params.get("disableIframe") === "true" ? false : true,
        }}
        fieldTransforms={{
          userField: ({ value }) => value,
        }}
        _experimentalFullScreenCanvas={false}
        overrides={{
          fieldTypes: {
            userField: ({ readOnly, field, name, value, onChange }) => (
              <FieldLabel
                label={field.label || name}
                readOnly={readOnly}
                icon={<Type size={16} />}
              >
                <AutoField
                  field={{ type: "text" }}
                  onChange={onChange}
                  value={value}
                />
              </FieldLabel>
            ),
          },
          headerActions: ({ children }) => (
            <>
              <PresenceAvatars others={others} />

              <div>
                <Button href={path} newTab variant="secondary">
                  View page
                </Button>
              </div>

              {children}
            </>
          ),
          componentOverlay: ({ children, id }) => (
            <PresenceOverlay blockId={id} others={others}>
              {children}
            </PresenceOverlay>
          ),
        }}
        metadata={metadata}
      >
        <PresenceSync sendUpdate={sendUpdate} />
      </Puck>
    </div>
  );
}

/**
 * Inner component that syncs Puck selection state → Convex presence.
 * Must be rendered inside <Puck> to access usePuck().
 */
function PresenceSync({
  sendUpdate,
}: {
  sendUpdate: (selection?: {
    selectedBlockId?: string;
    activeField?: string;
  }) => void;
}) {
  const selectedItem = usePuck((s) => s.selectedItem);
  const prevIdRef = useRef<string | undefined>();

  useEffect(() => {
    const blockId = selectedItem?.props?.id;
    if (blockId !== prevIdRef.current) {
      prevIdRef.current = blockId;
      sendUpdate({ selectedBlockId: blockId });
    }
  }, [selectedItem, sendUpdate]);

  return null;
}
