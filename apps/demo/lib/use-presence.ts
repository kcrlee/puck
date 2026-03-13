"use client";

import { useEffect, useRef, useCallback, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const PRESENCE_COLORS = [
  "#e06c75", // red
  "#61afef", // blue
  "#98c379", // green
  "#c678dd", // purple
  "#e5c07b", // yellow
  "#56b6c2", // cyan
  "#d19a66", // orange
  "#be5046", // dark red
];

export type PresenceUser = {
  pageId: Id<"pages">;
  userId: string;
  userName: string;
  userColor: string;
  selectedBlockId?: string;
  activeField?: string;
  updatedAt: number;
};

/**
 * Hook to manage presence state for the current user and observe other users.
 *
 * Sends heartbeats every 10s and updates on selection change.
 * Returns array of other users' presence states (excludes self).
 */
export function usePresence({
  pageId,
  userId,
  userName,
}: {
  pageId: Id<"pages"> | null;
  userId: string;
  userName: string;
}) {
  const updatePresence = useMutation(api.presence.update);
  const removePresence = useMutation(api.presence.remove);

  const userColor = useMemo(
    () => PRESENCE_COLORS[hashCode(userId) % PRESENCE_COLORS.length],
    [userId]
  );

  const selectionRef = useRef<{
    selectedBlockId?: string;
    activeField?: string;
  }>({});

  // Send presence update
  const sendUpdate = useCallback(
    (selection?: { selectedBlockId?: string; activeField?: string }) => {
      if (!pageId) return;

      if (selection) {
        selectionRef.current = selection;
      }

      updatePresence({
        pageId,
        userId,
        userName,
        userColor,
        ...selectionRef.current,
      });
    },
    [pageId, userId, userName, userColor, updatePresence]
  );

  // Heartbeat every 10 seconds
  useEffect(() => {
    if (!pageId) return;

    sendUpdate();
    const interval = setInterval(() => sendUpdate(), 10_000);

    return () => {
      clearInterval(interval);
      removePresence({ pageId, userId });
    };
  }, [pageId, userId, sendUpdate, removePresence]);

  // Subscribe to all presence for this page
  const allPresence = useQuery(
    api.presence.getForPage,
    pageId ? { pageId } : "skip"
  );

  // Filter out self
  const others = useMemo(
    () => (allPresence ?? []).filter((p) => p.userId !== userId),
    [allPresence, userId]
  );

  return { others, sendUpdate, userColor };
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}
