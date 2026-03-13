"use client";

import { ReactNode, CSSProperties } from "react";
import type { PresenceUser } from "./use-presence";

/**
 * Renders presence indicators for other users editing the same page.
 * Shows colored dots with names next to blocks being edited by other users.
 *
 * Wire into Puck via the `componentOverlay` override:
 * ```
 * overrides: {
 *   componentOverlay: ({ children, id }) => (
 *     <PresenceOverlay blockId={id} others={others}>
 *       {children}
 *     </PresenceOverlay>
 *   ),
 * }
 * ```
 */
export function PresenceOverlay({
  blockId,
  others,
  children,
}: {
  blockId: string;
  others: PresenceUser[];
  children: ReactNode;
}) {
  const editorsOnBlock = others.filter((u) => u.selectedBlockId === blockId);

  if (editorsOnBlock.length === 0) return <>{children}</>;

  const borderColor = editorsOnBlock[0].userColor;

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          position: "absolute",
          inset: -2,
          border: `2px solid ${borderColor}`,
          borderRadius: 4,
          pointerEvents: "none",
          zIndex: 50,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: -22,
          left: -2,
          display: "flex",
          gap: 4,
          zIndex: 51,
        }}
      >
        {editorsOnBlock.map((user) => (
          <PresenceBadge key={user.userId} user={user} />
        ))}
      </div>
      {children}
    </div>
  );
}

function PresenceBadge({ user }: { user: PresenceUser }) {
  const style: CSSProperties = {
    backgroundColor: user.userColor,
    color: "white",
    fontSize: 10,
    fontWeight: 600,
    padding: "2px 6px",
    borderRadius: 3,
    whiteSpace: "nowrap",
    lineHeight: "16px",
  };

  return <span style={style}>{user.userName}</span>;
}

/**
 * Header presence indicator showing all active users on the page.
 */
export function PresenceAvatars({ others }: { others: PresenceUser[] }) {
  if (others.length === 0) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {others.map((user) => (
        <div
          key={user.userId}
          title={user.userName}
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            backgroundColor: user.userColor,
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {user.userName.charAt(0).toUpperCase()}
        </div>
      ))}
    </div>
  );
}
