import { Data } from "../../types";
import { SetAction } from "../actions";
import { AppStore } from "../../store";
import { PrivateAppState } from "../../types/Internal";
import { syncDocFromState } from "../../crdt/sync";

export const setAction = <UserData extends Data>(
  state: PrivateAppState<UserData>,
  action: SetAction<UserData>,
  appStore: AppStore
): PrivateAppState<UserData> => {
  const doc = appStore.pageDocument;
  const config = appStore.config;

  // Use Y.Doc data as merge base (source of truth, not possibly-stale state.data)
  const currentData = doc.toPuckDataCached();
  const currentState = { ...state, data: currentData } as PrivateAppState<UserData>;

  if (typeof action.state === "object") {
    const merged = {
      ...currentState,
      ...action.state,
    };

    syncDocFromState(doc, merged.data, config);

    return {
      ...merged,
      data: doc.toPuckData(),
      indexes: { nodes: {}, zones: {} },
    } as PrivateAppState<UserData>;
  }

  // Function form: pass Y.Doc-current state to callback
  const newState = { ...currentState, ...action.state(currentState) };
  syncDocFromState(doc, newState.data, config);

  return {
    ...newState,
    data: doc.toPuckData(),
    indexes: { nodes: {}, zones: {} },
  } as PrivateAppState<UserData>;
};
