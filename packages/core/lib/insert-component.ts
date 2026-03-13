import { useAppStoreApi, commitDocToStore } from "../store";
import { addBlockToDoc, parseZoneCompound } from "../crdt/dispatch";
import { populateIds } from "./data/populate-ids";
import { generateId } from "./generate-id";
// Makes testing easier without mocks
export const insertComponent = async (
  componentType: string,
  zone: string,
  index: number,
  appStore: ReturnType<typeof useAppStoreApi>
) => {
  const { getState } = appStore;
  const id = generateId(componentType);

  const doc = getState().pageDocument;
  const config = getState().config;

  // Build component data with populated IDs for nested default props
  const emptyComponentData = populateIds(
    {
      type: componentType,
      props: {
        ...(config.components[componentType].defaultProps || {}),
        id,
      },
    },
    config
  );

  // Add block (and any default slot children) directly to Y.Doc
  const target = parseZoneCompound(zone);
  addBlockToDoc(doc, emptyComponentData, target, index, config);

  // Materialize and select the new item
  commitDocToStore(appStore, {
    onAction: {
      type: "insert",
      componentType,
      destinationIndex: index,
      destinationZone: zone,
      id,
    },
    ui: { itemSelector: { id } },
  });

  const block = doc.getBlock(id);
  if (!block) return;
  const itemData = { type: block.type, props: { ...block.props, id: block.id } };

  // Run any resolvers
  const resolveComponentData = getState().resolveComponentData;
  const resolved = await resolveComponentData(itemData, "insert");
  if (!resolved.didChange) return;

  // Extract non-slot props for doc update
  const { id: _resolvedId, ...propsToUpdate } = resolved.node.props;
  const componentConfig = config.components[resolved.node.type];
  const fields = componentConfig?.fields ?? {};
  const nonSlotProps: Record<string, any> = {};
  for (const [k, v] of Object.entries(propsToUpdate)) {
    if (!(fields[k] && fields[k].type === "slot")) {
      nonSlotProps[k] = v;
    }
  }

  getState().pageDocument.updateProps(id, nonSlotProps);
  commitDocToStore(appStore, {
    onAction: {
      type: "replace",
      data: resolved.node,
      destinationIndex: 0,
      destinationZone: "",
    },
  });
};
