import { useMemo } from "react";
import { useAppStore, useAppStoreApi } from "../store";
import { ComponentData } from "../types";

export const useParent = () => {
  const appStore = useAppStoreApi();
  const selectedId = useAppStore((s) => s.selectedItem?.props.id);

  return useMemo(() => {
    if (!selectedId) return null;
    const doc = appStore.getState().pageDocument;
    const parentInfo = doc.findParent(selectedId);
    if (!parentInfo) return null;
    const parentBlock = doc.getBlock(parentInfo.parentId);
    if (!parentBlock) return null;
    return {
      type: parentBlock.type,
      props: { ...parentBlock.props, id: parentBlock.id },
    } as ComponentData;
  }, [appStore, selectedId]);
};
