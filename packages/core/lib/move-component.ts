import { useAppStoreApi, commitDocToStore } from "../store";
import { rootDroppableId } from "./root-droppable-id";
import { syncDocFromState } from "../crdt/sync";
import { parseZoneCompound } from "../crdt/dispatch";

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
  const doc = appStore.getState().pageDocument;
  const config = appStore.getState().config;
  const sourceZone = source.zone ?? rootDroppableId;
  const destinationZone = destination.zone ?? rootDroppableId;

  // Pre-sync doc to handle any external state changes
  syncDocFromState(doc, appStore.getState().state.data, config);

  // Move block directly in Y.Doc
  const target = parseZoneCompound(destinationZone);
  doc.moveBlock(id, target, destination.index);

  commitDocToStore(appStore, {
    onAction: {
      type: "move",
      sourceIndex: source.index,
      sourceZone,
      destinationIndex: destination.index,
      destinationZone,
    },
  });

  const block = doc.getBlock(id);
  if (!block) return;
  const componentData = { type: block.type, props: { ...block.props, id: block.id } };

  const resolveComponentData = appStore.getState().resolveComponentData;
  const resolvedData = await resolveComponentData(componentData, "move");

  if (resolvedData.didChange) {
    // Extract non-slot props for doc update
    const { id: _resolvedId, ...propsToUpdate } = resolvedData.node.props;
    const componentConfig = config.components[resolvedData.node.type];
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
