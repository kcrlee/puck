import { Data } from "../../types";
import { SetDataAction } from "../actions";
import { AppStore } from "../../store";
import { PrivateAppState } from "../../types/Internal";
import { syncDocFromState } from "../../crdt/sync";

export const setDataAction = <UserData extends Data>(
  state: PrivateAppState<UserData>,
  action: SetDataAction,
  appStore: AppStore
): PrivateAppState<UserData> => {
  const doc = appStore.pageDocument;
  const config = appStore.config;

  // Use Y.Doc data as merge base (source of truth, not possibly-stale state.data)
  const currentData = doc.toPuckDataCached();

  const mergedData =
    typeof action.data === "object"
      ? { ...currentData, ...action.data }
      : { ...currentData, ...action.data(currentData) };

  syncDocFromState(doc, mergedData, config);

  return {
    ...state,
    data: doc.toPuckData(),
    indexes: { nodes: {}, zones: {} },
  } as PrivateAppState<UserData>;
};
