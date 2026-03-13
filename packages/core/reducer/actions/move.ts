import { Data } from "../../types";
import { MoveAction } from "../actions";
import { AppStore } from "../../store";
import { PrivateAppState } from "../../types/Internal";
import { getBlockIdAtIndex, parseZoneCompound } from "../../crdt/dispatch";

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

  // Only materialize data when callbacks need it; skip expensive walkAppState
  if (appStore.onAction) {
    return {
      data: doc.toPuckData(),
      ui: state.ui,
      indexes: { nodes: {}, zones: {} },
    } as PrivateAppState<UserData>;
  }

  return state;
};
