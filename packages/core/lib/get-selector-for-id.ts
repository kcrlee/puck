import { ItemSelector } from "./data/get-item";
import { PageDocument } from "../crdt/PageDocument";

export const getSelectorForId = (
  doc: PageDocument,
  id: string
): ItemSelector | undefined => {
  if (!doc.getBlock(id)) return;

  return { id };
};

/** Look up the position (zone compound + index) for a block by ID. Used for dispatching position-based actions. */
export const getPositionForId = (
  doc: PageDocument,
  id: string
): { zone: string; index: number } | undefined => {
  const parentInfo = doc.findParent(id);
  if (!parentInfo) return;

  const parentId = parentInfo.parentId ?? "root";
  const zoneCompound = `${parentId}:${parentInfo.slotName}`;
  const children = doc.getSlotChildren(parentId, parentInfo.slotName);
  const index = children.indexOf(id);

  return { zone: zoneCompound, index };
};
