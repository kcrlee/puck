import { Data } from "../../types";
import { ReplaceAction } from "../actions";
import { AppStore } from "../../store";
import { PrivateAppState } from "../../types/Internal";
import { syncDocFromState } from "../../crdt/sync";

// Backward-compat: production callers migrated to doc.updateProps +
// commitDocToStore. This path kept for external API users and tests.
// Syncs the replacement through Y.Doc for canonical data.
export const replaceAction = <UserData extends Data>(
  state: PrivateAppState<UserData>,
  action: ReplaceAction<UserData>,
  appStore: AppStore
): PrivateAppState<UserData> => {
  const doc = appStore.pageDocument;
  const config = appStore.config;
  const blockId = action.data.props.id;

  if (!blockId) {
    return state;
  }

  // Extract non-slot props from replacement data
  const { id: _id, ...propsToUpdate } = action.data.props;
  const componentConfig = config.components[action.data.type];
  const fields = componentConfig?.fields ?? {};
  const nonSlotProps: Record<string, any> = {};
  for (const [k, v] of Object.entries(propsToUpdate)) {
    if (!(fields[k] && fields[k].type === "slot")) {
      nonSlotProps[k] = v;
    }
  }

  doc.updateProps(blockId, nonSlotProps);

  return {
    ...state,
    data: doc.toPuckData(),
    ui: { ...state.ui, ...action.ui },
    indexes: { nodes: {}, zones: {} },
  } as PrivateAppState<UserData>;
};
