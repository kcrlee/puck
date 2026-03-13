import { Data } from "../../types";
import { generateId } from "../../lib/generate-id";
import { InsertAction } from "../actions";
import { PrivateAppState } from "../../types/Internal";
import { AppStore } from "../../store";
import { populateIds } from "../../lib/data/populate-ids";
import { addBlockToDoc, parseZoneCompound } from "../../crdt/dispatch";
import { materializeAppState } from "../../crdt/compat";

export function insertAction<UserData extends Data>(
  state: PrivateAppState<UserData>,
  action: InsertAction,
  appStore: AppStore
): PrivateAppState<UserData> {
  const doc = appStore.pageDocument;
  const id = action.id || generateId(action.componentType);

  // Build the component data with populated IDs for nested default props
  const emptyComponentData = populateIds(
    {
      type: action.componentType,
      props: {
        ...(appStore.config.components[action.componentType].defaultProps ||
          {}),
        id,
      },
    },
    appStore.config
  );

  const target = parseZoneCompound(action.destinationZone);
  addBlockToDoc(doc, emptyComponentData, target, action.destinationIndex, appStore.config);

  return materializeAppState(
    doc,
    state.ui,
    appStore.config
  ) as PrivateAppState<UserData>;
}
