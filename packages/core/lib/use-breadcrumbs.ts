import { useMemo } from "react";
import { useAppStore, useAppStoreApi } from "../store";
import { ItemSelector } from "./data/get-item";

export type Breadcrumb = {
  label: string;
  selector: ItemSelector | null;
  zoneCompound?: string;
};

export const useBreadcrumbs = (renderCount?: number) => {
  const selectedId = useAppStore((s) => s.selectedItem?.props.id);
  const config = useAppStore((s) => s.config);
  const appStore = useAppStoreApi();

  // Derive path from Y.Doc parent index
  const path = useMemo(
    () => (selectedId ? appStore.getState().pageDocument.getPath(selectedId) : undefined),
    [appStore, selectedId]
  );

  return useMemo<Breadcrumb[]>(() => {
    const doc = appStore.getState().pageDocument;
    const breadcrumbs =
      path?.map((zoneCompound) => {
        const [componentId] = zoneCompound.split(":");

        if (componentId === "root") {
          return {
            label: config?.root?.label || "Page",
            selector: null,
          };
        }

        const blockType = doc.getBlockType(componentId);

        const label = blockType
          ? config.components[blockType]?.label ?? blockType
          : "Component";

        return {
          label,
          selector: blockType ? { id: componentId } : null,
        };
      }) || [];

    if (renderCount) {
      return breadcrumbs.slice(breadcrumbs.length - renderCount);
    }

    return breadcrumbs;
  }, [path, renderCount]);
};
