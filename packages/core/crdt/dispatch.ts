/**
 * Helpers for translating Puck's zone-compound action format
 * into PageDocument's BlockTarget format.
 */

import { Config } from "../types";
import { PageDocument } from "./PageDocument";
import { BlockTarget } from "./types";
import { rootAreaId, rootZone } from "../lib/root-droppable-id";

/**
 * Parse a zone compound string ("parentId:slotName") into a BlockTarget.
 * Root zone ("root:default-zone") maps to { parentId: null, slotName: "default-zone" }.
 */
export function parseZoneCompound(zoneCompound: string): BlockTarget {
  const [parentId, slotName] = zoneCompound.split(":");
  return {
    parentId: parentId === rootAreaId ? null : parentId,
    slotName: slotName || rootZone,
  };
}

/**
 * Get the block ID at a given index within a zone.
 */
export function getBlockIdAtIndex(
  doc: PageDocument,
  zoneCompound: string,
  index: number
): string | null {
  const { parentId, slotName } = parseZoneCompound(zoneCompound);

  if (parentId === null && slotName === "default-zone") {
    const rootIds = doc.getRootBlockIds();
    return rootIds[index] ?? null;
  }

  if (parentId === null) {
    // Root slot (e.g., root:header)
    const children = doc.getSlotChildren("root", slotName);
    return children[index] ?? null;
  }

  const children = doc.getSlotChildren(parentId, slotName);
  return children[index] ?? null;
}

/**
 * Build slot definitions for a new block from config.
 * Returns empty arrays for each slot field.
 */
export function buildSlotDefs(
  componentType: string,
  config: Config
): Record<string, string[]> {
  const componentConfig = config.components[componentType];
  if (!componentConfig?.fields) return {};

  const slotDefs: Record<string, string[]> = {};
  for (const [fieldName, field] of Object.entries(componentConfig.fields)) {
    if (field.type === "slot") {
      slotDefs[fieldName] = [];
    }
  }
  return slotDefs;
}
