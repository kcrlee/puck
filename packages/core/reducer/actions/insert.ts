import { Data } from "../../types";
import { generateId } from "../../lib/generate-id";
import { InsertAction } from "../actions";
import { PrivateAppState } from "../../types/Internal";
import { AppStore } from "../../store";
import { populateIds } from "../../lib/data/populate-ids";
import { parseZoneCompound } from "../../crdt/dispatch";
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

  // Recursively add blocks for the component and any default slot children
  const addBlockRecursive = (
    componentData: { type: string; props: Record<string, any>; readOnly?: any },
    target: ReturnType<typeof parseZoneCompound>,
    index: number
  ): string => {
    const blockId = componentData.props.id;
    const componentConfig = appStore.config.components[componentData.type];
    const fields = componentConfig?.fields ?? {};

    // Separate slot content from regular props
    const props: Record<string, any> = {};
    const slotDefs: Record<string, string[]> = {};

    for (const [key, val] of Object.entries(componentData.props)) {
      if (key === "id") continue;
      const field = fields[key];
      if (field && field.type === "slot") {
        const children = (val as any[]) ?? [];
        const childIds: string[] = [];
        for (let i = 0; i < children.length; i++) {
          const childId = addBlockRecursive(
            children[i],
            { parentId: blockId, slotName: key },
            i
          );
          childIds.push(childId);
        }
        slotDefs[key] = childIds;
      } else {
        props[key] = val;
      }
    }

    // Ensure all slot fields have entries (even if empty)
    for (const [fieldName, fieldDef] of Object.entries(fields)) {
      if (fieldDef.type === "slot" && !(fieldName in slotDefs)) {
        slotDefs[fieldName] = [];
      }
    }

    // Add to Y.Doc — but only the top-level block gets inserted at the target;
    // nested blocks are inserted at their parent's slot by recursion above
    doc.addBlock(
      componentData.type,
      props,
      slotDefs,
      target,
      index,
      blockId,
      componentData.readOnly
    );

    return blockId;
  };

  const target = parseZoneCompound(action.destinationZone);
  addBlockRecursive(emptyComponentData, target, action.destinationIndex);

  return materializeAppState(
    doc,
    state.ui,
    appStore.config
  ) as PrivateAppState<UserData>;
}
