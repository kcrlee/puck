import { useAppStoreApi, commitDocToStore } from "../store";
import { rootDroppableId } from "./root-droppable-id";

/**
 * Moves a component, resolves its data, and updates the appStore state.
 * @param id - Id of the component to move.
 * @param source - The source position (zone + index) of the component.
 * @param destination - The target position (zone + index) to move the component to.
 * @param appStore - The appStore instance where the component is.
 * @returns A promise that resolves when the move operation is complete.
 */
export const moveComponent = async (
  id: string,
  source: { zone: string; index: number },
  destination: { zone: string; index: number },
  appStore: ReturnType<typeof useAppStoreApi>
) => {
  const dispatch = appStore.getState().dispatch;
  dispatch({
    type: "move",
    sourceIndex: source.index,
    sourceZone: source.zone ?? rootDroppableId,
    destinationIndex: destination.index,
    destinationZone: destination.zone ?? rootDroppableId,
    recordHistory: false,
  });

  const componentData = appStore.getState().state.indexes.nodes[id]?.data;
  if (!componentData) return;

  const resolveComponentData = appStore.getState().resolveComponentData;
  const resolvedData = await resolveComponentData(componentData, "move");

  if (resolvedData.didChange) {
    // Extract non-slot props for doc update
    const { id: _resolvedId, ...propsToUpdate } = resolvedData.node.props;
    const componentConfig =
      appStore.getState().config.components[resolvedData.node.type];
    const fields = componentConfig?.fields ?? {};
    const nonSlotProps: Record<string, any> = {};
    for (const [k, v] of Object.entries(propsToUpdate)) {
      if (!(fields[k] && fields[k].type === "slot")) {
        nonSlotProps[k] = v;
      }
    }

    appStore.getState().pageDocument.updateProps(id, nonSlotProps);
    commitDocToStore(appStore, {
      onAction: {
        type: "replace",
        data: resolvedData.node,
        destinationIndex: 0,
        destinationZone: "",
      },
    });
  }
};
