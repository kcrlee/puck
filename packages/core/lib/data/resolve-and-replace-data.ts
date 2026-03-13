import { AppStoreApi, commitDocToStore } from "../../store";
import { ComponentData, ResolveDataTrigger } from "../../types";
import { toComponent } from "./to-component";

export async function resolveAndReplaceData(
  currentData: ComponentData,
  appStoreApi: AppStoreApi,
  trigger: ResolveDataTrigger = "force"
) {
  const getState = appStoreApi.getState;
  const resolvedResult = await getState().resolveComponentData(
    currentData,
    trigger
  );
  if (!resolvedResult.didChange) return;

  const resolved = toComponent(resolvedResult.node);
  const id = resolved.props.id;

  // Ensure the component still exists
  if (!getState().pageDocument.getBlock(id)) {
    console.warn(
      `Warning: Could not find component with id "${currentData.props.id}" to resolve its data. Component may have been removed or the id is invalid.`
    );
    return;
  }

  // Extract non-slot props for doc update
  const { id: _id, ...propsToUpdate } = resolved.props;
  const componentConfig = getState().config.components[resolved.type];
  const fields = componentConfig?.fields ?? {};
  const nonSlotProps: Record<string, any> = {};
  for (const [k, v] of Object.entries(propsToUpdate)) {
    if (!(fields[k] && fields[k].type === "slot")) {
      nonSlotProps[k] = v;
    }
  }

  getState().pageDocument.updateProps(id, nonSlotProps);
  commitDocToStore(appStoreApi, {
    onAction: {
      type: "replace",
      data: resolved,
      destinationIndex: 0,
      destinationZone: "",
    },
  });
}
