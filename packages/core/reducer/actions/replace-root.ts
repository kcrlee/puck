import { Data } from "../../types";
import { ReplaceRootAction } from "../actions";
import { AppStore } from "../../store";
import { PrivateAppState } from "../../types/Internal";

// Backward-compat: production callers migrated to doc.updateRootProps +
// commitDocToStore. This path kept for external API users and tests.
export const replaceRootAction = <UserData extends Data>(
  state: PrivateAppState<UserData>,
  action: ReplaceRootAction<UserData>,
  appStore: AppStore
): PrivateAppState<UserData> => {
  const doc = appStore.pageDocument;
  const config = appStore.config;

  // Extract non-slot props from root replacement
  const { id: _id, ...propsToUpdate } = action.root.props ?? {};
  const rootFields = config.root?.fields ?? {};
  const nonSlotProps: Record<string, any> = {};
  for (const [k, v] of Object.entries(propsToUpdate)) {
    if (!(rootFields[k] && rootFields[k].type === "slot")) {
      nonSlotProps[k] = v;
    }
  }

  doc.updateRootProps(nonSlotProps);

  return {
    ...state,
    data: doc.toPuckData(),
    ui: state.ui,
    indexes: { nodes: {}, zones: {} },
  } as PrivateAppState<UserData>;
};
