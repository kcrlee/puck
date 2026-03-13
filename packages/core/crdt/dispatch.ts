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

/**
 * Recursively add a block and its default slot children to the Y.Doc.
 * Separates slot content from regular props and ensures all slot fields
 * have entries (even if empty).
 */
export function addBlockToDoc(
  doc: PageDocument,
  componentData: { type: string; props: Record<string, any>; readOnly?: any },
  target: BlockTarget,
  index: number,
  config: Config
): string {
  const blockId = componentData.props.id;
  const componentConfig = config.components[componentData.type];
  const fields = componentConfig?.fields ?? {};

  const props: Record<string, any> = {};
  const slotDefs: Record<string, string[]> = {};

  for (const [key, val] of Object.entries(componentData.props)) {
    if (key === "id") continue;
    const field = fields[key];
    if (field && field.type === "slot") {
      const children = (val as any[]) ?? [];
      const childIds: string[] = [];
      for (let i = 0; i < children.length; i++) {
        const childId = addBlockToDoc(
          doc,
          children[i],
          { parentId: blockId, slotName: key },
          i,
          config
        );
        childIds.push(childId);
      }
      slotDefs[key] = childIds;
    } else {
      props[key] = val;
    }
  }

  // Ensure all slot fields have entries (even if empty)
  for (const [fieldName, fieldDef] of Object.entries(fields)) {
    if (fieldDef.type === "slot" && !(fieldName in slotDefs)) {
      slotDefs[fieldName] = [];
    }
  }

  doc.addBlock(
    componentData.type,
    props,
    slotDefs,
    target,
    index,
    blockId,
    componentData.readOnly
  );

  return blockId;
}
