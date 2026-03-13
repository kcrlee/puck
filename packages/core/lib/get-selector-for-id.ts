import { ItemSelector } from "./data/get-item";
import { PrivateAppState } from "../types/Internal";

export const getSelectorForId = (
  state: PrivateAppState,
  id: string
): ItemSelector | undefined => {
  const node = state.indexes.nodes[id];

  if (!node) return;

  return { id };
};

/** Look up the position (zone compound + index) for a block by ID. Used for dispatching position-based actions. */
export const getPositionForId = (
  state: PrivateAppState,
  id: string
): { zone: string; index: number } | undefined => {
  const node = state.indexes.nodes[id];

  if (!node) return;

  const zoneCompound = `${node.parentId}:${node.zone}`;

  const index = state.indexes.zones[zoneCompound].contentIds.indexOf(id);

  return { zone: zoneCompound, index };
};
