import { Data } from "../../types";
import { DuplicateAction } from "../actions";
import { PrivateAppState } from "../../types/Internal";
import { AppStore } from "../../store";
import { getBlockIdAtIndex, parseZoneCompound } from "../../crdt/dispatch";

export function duplicateAction<UserData extends Data>(
  state: PrivateAppState<UserData>,
  action: DuplicateAction,
  appStore: AppStore
): PrivateAppState<UserData> {
  const doc = appStore.pageDocument;

  // Resolve block ID from source zone + index
  const blockId = getBlockIdAtIndex(
    doc,
    action.sourceZone,
    action.sourceIndex
  );
  if (!blockId) return state;

  // Duplicate block (deep clone with new IDs, inserted after source)
  const target = parseZoneCompound(action.sourceZone);
  const duplicatedId = doc.duplicateBlock(blockId, target, action.sourceIndex + 1);

  const updatedUi = {
    ...state.ui,
    itemSelector: duplicatedId ? { id: duplicatedId } : null,
  };

  // Only materialize data when callbacks need it; skip expensive walkAppState
  if (appStore.onAction) {
    return {
      data: doc.toPuckData(),
      ui: updatedUi,
      indexes: { nodes: {}, zones: {} },
    } as PrivateAppState<UserData>;
  }

  return { ...state, ui: updatedUi };
}
