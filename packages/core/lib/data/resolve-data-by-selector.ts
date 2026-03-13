import { AppStoreApi } from "../../store";
import { blockToComponentData } from "../../crdt/block-data";
import { ResolveDataTrigger } from "../../types";
import { ItemSelector } from "./get-item";
import { resolveAndReplaceData } from "./resolve-and-replace-data";

export async function resolveDataBySelector(
  selector: ItemSelector,
  appStoreApi: AppStoreApi,
  trigger?: ResolveDataTrigger
) {
  const { pageDocument } = appStoreApi.getState();
  const item = blockToComponentData(pageDocument, selector.id);

  if (!item) {
    console.warn(
      `Warning: Could not find component for selector "${JSON.stringify(
        selector
      )}" to resolve its data. Component may have been removed or the selector is invalid.`
    );
    return;
  }

  await resolveAndReplaceData(item, appStoreApi, trigger);
}
