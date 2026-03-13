import { AppStoreApi } from "../../store";
import { ResolveDataTrigger } from "../../types";
import { resolveAndReplaceData } from "./resolve-and-replace-data";

export async function resolveDataById(
  id: string,
  appStoreApi: AppStoreApi,
  trigger?: ResolveDataTrigger
) {
  const doc = appStoreApi.getState().pageDocument;
  const block = doc.getBlock(id);

  if (!block) {
    console.warn(
      `Warning: Could not find component with id "${id}" to resolve its data. Component may have been removed or the id is invalid.`
    );
    return;
  }

  await resolveAndReplaceData(
    { type: block.type, props: { ...block.props, id: block.id } },
    appStoreApi,
    trigger
  );
}
