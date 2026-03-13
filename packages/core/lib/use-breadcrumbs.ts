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
  const path = useAppStore((s) => s.state.indexes.nodes[selectedId]?.path);
  const appStore = useAppStoreApi();

  return useMemo<Breadcrumb[]>(() => {
    const breadcrumbs =
      path?.map((zoneCompound) => {
        const [componentId] = zoneCompound.split(":");

        if (componentId === "root") {
          return {
            label: config?.root?.label || "Page",
            selector: null,
          };
        }

        const node = appStore.getState().state.indexes.nodes[componentId];

        const label = node
          ? config.components[node.data.type]?.label ?? node.data.type
          : "Component";

        return {
          label,
          selector: node ? { id: componentId } : null,
        };
      }) || [];

    if (renderCount) {
      return breadcrumbs.slice(breadcrumbs.length - renderCount);
    }

    return breadcrumbs;
  }, [path, renderCount]);
};
