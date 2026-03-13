import { Data } from "../../types";
import { RemoveAction } from "../actions";
import { AppStore } from "../../store";
import { PrivateAppState } from "../../types/Internal";
import { getBlockIdAtIndex } from "../../crdt/dispatch";
import { materializeAppState } from "../../crdt/compat";

export const removeAction = <UserData extends Data>(
  state: PrivateAppState<UserData>,
  action: RemoveAction,
  appStore: AppStore
): PrivateAppState<UserData> => {
  const doc = appStore.pageDocument;

  // Resolve block ID from zone compound + index
  const blockId = getBlockIdAtIndex(doc, action.zone, action.index);
  if (!blockId) return state;

  // Remove block (and all children) via PageDocument
  doc.removeBlock(blockId);

  // Materialize new state from Y.Doc
  return materializeAppState(
    doc,
    state.ui,
    appStore.config
  ) as PrivateAppState<UserData>;
};
