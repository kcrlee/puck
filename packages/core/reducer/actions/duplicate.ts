import { Data } from "../../types";
import { DuplicateAction } from "../actions";
import { PrivateAppState } from "../../types/Internal";
import { AppStore } from "../../store";
import { getBlockIdAtIndex, parseZoneCompound } from "../../crdt/dispatch";
import { materializeAppState } from "../../crdt/compat";

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

  const newState = materializeAppState(
    doc,
    state.ui,
    appStore.config
  ) as PrivateAppState<UserData>;

  return {
    ...newState,
    ui: {
      ...newState.ui,
      itemSelector: duplicatedId ? { id: duplicatedId } : null,
    },
  };
}
