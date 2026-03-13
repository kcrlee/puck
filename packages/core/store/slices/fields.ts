import { ComponentData } from "../../types";
import type { Fields } from "../../types";
import { AppStore, useAppStoreApi } from "../";
import { useCallback, useEffect, useRef } from "react";
import { getChanged } from "../../lib/get-changed";

type ComponentOrRootData = Omit<ComponentData<any>, "type">;

export type FieldsSlice = {
  fields: Fields | Partial<Fields>;
  loading: boolean;
  lastResolvedData: Partial<ComponentOrRootData>;
  id: string | undefined;
};

export const createFieldsSlice = (
  _set: (newState: Partial<AppStore>) => void,
  _get: () => AppStore
): FieldsSlice => {
  return {
    fields: {},
    loading: false,
    lastResolvedData: {},
    id: undefined,
  };
};

export const useRegisterFieldsSlice = (
  appStore: ReturnType<typeof useAppStoreApi>,
  id?: string
) => {
  const resolveFields = useCallback(
    async (reset?: boolean) => {
      const { fields, lastResolvedData } = appStore.getState().fields;
      const metadata = appStore.getState().metadata;
      const doc = appStore.getState().pageDocument;
      const config = appStore.getState().config;

      // Read component data from Y.Doc
      let componentData: ComponentOrRootData | null = null;
      let parent: ComponentData | null = null;

      if (id && id !== "root") {
        const block = doc.getBlock(id);
        if (block) {
          componentData = { type: block.type, props: { ...block.props, id: block.id } } as any;
        }

        // Parent data from Y.Doc (getLocation includes root-level blocks where parentId is null)
        const location = doc.getLocation(id);
        if (location) {
          if (location.parentId === null) {
            // Root-level block — parent is the root
            const { __readOnly, ...rootProps } = doc.getRootPropsJSON();
            parent = { type: "root", props: { ...rootProps, id: "root" } } as ComponentData;
          } else {
            const parentBlock = doc.getBlock(location.parentId);
            if (parentBlock) {
              parent = { type: parentBlock.type, props: { ...parentBlock.props, id: parentBlock.id } } as ComponentData;
            }
          }
        }
      } else {
        // Root
        const { __readOnly, ...rootProps } = doc.getRootPropsJSON();
        componentData = { type: "root", props: { ...rootProps, id: "root" } } as any;
      }

      const { getComponentConfig, state, pageDocument } = appStore.getState();

      const componentConfig = getComponentConfig((componentData as any)?.type);

      if (!componentData || !componentConfig) return;

      const defaultFields = componentConfig.fields || {};
      const resolver = componentConfig.resolveFields;
      let lastFields: Fields | null = fields as Fields;

      if (reset) {
        appStore.setState((s) => ({
          fields: { ...s.fields, fields: defaultFields, id },
        }));

        lastFields = defaultFields;
      }

      if (resolver) {
        const timeout = setTimeout(() => {
          appStore.setState((s) => ({
            fields: { ...s.fields, loading: true },
          }));
        }, 50);

        const lastData =
          lastResolvedData.props?.id === id ? lastResolvedData : null;

        const changed = getChanged(componentData, lastData);

        const newFields = await resolver(componentData, {
          changed,
          fields: defaultFields,
          lastFields,
          metadata: { ...metadata, ...componentConfig.metadata },
          lastData: lastData as ComponentOrRootData,
          appState: { data: pageDocument.toPuckDataCached(), ui: state.ui },
          parent,
        });

        clearTimeout(timeout);

        // Abort if item has changed during resolution (happens with history)
        if (appStore.getState().selectedItem?.props.id !== id) {
          return;
        }

        appStore.setState({
          fields: {
            fields: newFields,
            loading: false,
            lastResolvedData: componentData,
            id,
          },
        });
      } else {
        appStore.setState((s) => ({
          fields: { ...s.fields, fields: defaultFields, id },
        }));
      }
    },
    [id]
  );

  // Track last-seen block snapshot for deduplication
  const lastSnapshotRef = useRef<string | null>(null);

  useEffect(() => {
    resolveFields(true);

    // Capture initial snapshot
    const doc = appStore.getState().pageDocument;
    if (id && id !== "root") {
      const block = doc.getBlock(id);
      lastSnapshotRef.current = block ? JSON.stringify(block.props) : null;
    } else {
      lastSnapshotRef.current = JSON.stringify(doc.getRootPropsJSON());
    }

    // Subscribe to Y.Doc changes with change detection (syncDocFromState
    // clears-and-rebuilds, firing all observers even for unchanged blocks).
    // Deferred via queueMicrotask so Zustand state is updated before we read it.
    const handleChange = () => {
      queueMicrotask(() => {
        let snapshot: string | null;
        if (id && id !== "root") {
          const block = doc.getBlock(id);
          snapshot = block ? JSON.stringify(block.props) : null;
        } else {
          snapshot = JSON.stringify(doc.getRootPropsJSON());
        }

        if (snapshot !== lastSnapshotRef.current) {
          lastSnapshotRef.current = snapshot;
          resolveFields();
        }
      });
    };

    const unsub = (id && id !== "root")
      ? doc.subscribeBlock(id, handleChange)
      : doc.subscribeRootProps(handleChange);

    return unsub;
  }, [id]);
};
