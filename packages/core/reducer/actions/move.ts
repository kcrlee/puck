import { Content, Data } from "../../types";
import { MoveAction } from "../actions";
import { AppStore } from "../../store";
import { PrivateAppState } from "../../types/Internal";
import { getBlockIdAtIndex, parseZoneCompound } from "../../crdt/dispatch";
import { materializeAppState } from "../../crdt/compat";

// Restore unregistered zones when re-registering in same session
export const zoneCache: Record<string, Content> = {};

export const addToZoneCache = (key: string, data: Content) => {
  zoneCache[key] = data;
};

export const moveAction = <UserData extends Data>(
  state: PrivateAppState<UserData>,
  action: MoveAction,
  appStore: AppStore
): PrivateAppState<UserData> => {
  if (
    action.sourceZone === action.destinationZone &&
    action.sourceIndex === action.destinationIndex
  ) {
    return state;
  }

  const doc = appStore.pageDocument;

  // Resolve block ID from source zone + index
  const blockId = getBlockIdAtIndex(doc, action.sourceZone, action.sourceIndex);
  if (!blockId) return state;

  const target = parseZoneCompound(action.destinationZone);

  doc.moveBlock(blockId, target, action.destinationIndex);

  return materializeAppState(
    doc,
    state.ui,
    appStore.config
  ) as PrivateAppState<UserData>;
};
