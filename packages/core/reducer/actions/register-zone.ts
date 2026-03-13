import { RegisterZoneAction, UnregisterZoneAction } from "..";
import { Data } from "../../types";
import { PrivateAppState } from "../../types/Internal";

// No-ops: With Y.Doc, slot data persists in Y.Arrays regardless of
// component mount state. Zone registration/caching is unnecessary.

export function registerZoneAction<UserData extends Data>(
  state: PrivateAppState<UserData>,
  _action: RegisterZoneAction
): PrivateAppState<UserData> {
  return state;
}

export function unregisterZoneAction<UserData extends Data>(
  state: PrivateAppState<UserData>,
  _action: UnregisterZoneAction
): PrivateAppState<UserData> {
  return state;
}
