"use client";

import {
  Config,
  IframeConfig,
  Overrides,
  AppState,
  UiState,
  Plugin,
  UserGenerics,
  Field,
  ComponentConfig,
  Metadata,
  ComponentData,
  RootDataWithProps,
  ResolveDataTrigger,
  RichtextField,
} from "../types";
import { createReducer, PuckAction } from "../reducer";
import { defaultViewports } from "../components/ViewportControls/default-viewports";
import { Viewports } from "../types";
import { create, StoreApi, useStore } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { createContext, useContext } from "react";
import { createHistorySlice, type HistorySlice } from "./slices/history";
import { createNodesSlice, type NodesSlice } from "./slices/nodes";
import {
  createPermissionsSlice,
  type PermissionsSlice,
} from "./slices/permissions";
import { createFieldsSlice, type FieldsSlice } from "./slices/fields";
import { resolveComponentData } from "../lib/resolve-component-data";
import { walkAppState } from "../lib/data/walk-app-state";

import { generateId } from "../lib/generate-id";
import { defaultAppState } from "./default-app-state";
import { FieldTransforms } from "../types/API/FieldTransforms";
import type { Editor } from "@tiptap/react";
import { PageDocument } from "../crdt/PageDocument";
import { materializeAppState } from "../crdt/compat";
import { syncDocFromState } from "../crdt/sync";

export { defaultAppState };

export type Status = "LOADING" | "MOUNTED" | "READY";

type ZoomConfig = {
  autoZoom: number;
  rootHeight: number;
  zoom: number;
};

type ComponentState = Record<string, { loadingCount: number }>;

export type AppStore<
  UserConfig extends Config = Config,
  G extends UserGenerics<UserConfig> = UserGenerics<UserConfig>
> = {
  instanceId: string;
  state: G["UserAppState"];
  dispatch: (action: PuckAction) => void;
  config: UserConfig;
  componentState: ComponentState;
  setComponentState: (componentState: ComponentState) => void;
  setComponentLoading: (
    id: string,
    loading?: boolean,
    defer?: number
  ) => () => void;
  unsetComponentLoading: (id: string) => void;
  pendingLoadTimeouts: Record<string, NodeJS.Timeout>;
  resolveComponentData: <T extends ComponentData | RootDataWithProps>(
    componentData: T,
    trigger: ResolveDataTrigger
  ) => Promise<{ node: T; didChange: boolean }>;
  resolveAndCommitData: () => void;
  plugins: Plugin[];
  overrides: Partial<Overrides>;
  viewports: Viewports;
  zoomConfig: ZoomConfig;
  setZoomConfig: (zoomConfig: ZoomConfig) => void;
  status: Status;
  setStatus: (status: Status) => void;
  iframe: IframeConfig;
  selectedItem?: G["UserData"]["content"][0] | null;
  getCurrentData: () => G["UserData"]["content"][0] | G["UserData"]["root"];
  setUi: (ui: Partial<UiState>, recordHistory?: boolean) => void;
  getComponentConfig: (type?: string) => ComponentConfig | null | undefined;
  onAction?: (action: PuckAction, newState: AppState, state: AppState) => void;
  metadata: Metadata;
  fields: FieldsSlice;
  history: HistorySlice;
  nodes: NodesSlice;
  permissions: PermissionsSlice;
  pageDocument: PageDocument;
  fieldTransforms: FieldTransforms;
  currentRichText?: {
    inlineComponentId?: string;
    inline: boolean;
    field: RichtextField;
    editor: Editor;
    id: string;
  } | null;
};

export type AppStoreApi = StoreApi<AppStore>;

const defaultPageFields: Record<string, Field> = {
  title: { type: "text" },
};

export const createAppStore = (initialAppStore?: Partial<AppStore>) => {
  // Create the PageDocument from initial state + config
  const initialConfig = initialAppStore?.config ?? { components: {} };
  const initialData = initialAppStore?.state?.data ?? defaultAppState.data;
  const pageDocument =
    initialAppStore?.pageDocument ??
    PageDocument.fromPuckData(initialData, initialConfig);

  // Keep the PageDocument's config in sync
  pageDocument.config = initialConfig;

  return create<AppStore>()(
    subscribeWithSelector((set, get) => ({
      instanceId: generateId(),
      state: defaultAppState,
      config: { components: {} },
      componentState: {},
      plugins: [],
      overrides: {},
      viewports: defaultViewports,
      zoomConfig: {
        autoZoom: 1,
        rootHeight: 0,
        zoom: 1,
      },
      status: "LOADING",
      iframe: {},
      metadata: {},
      fieldTransforms: {},
      ...initialAppStore,
      pageDocument,
      fields: createFieldsSlice(set, get),
      history: createHistorySlice(set, get),
      nodes: createNodesSlice(set, get),
      permissions: createPermissionsSlice(set, get),
      getCurrentData: () => {
        const s = get();

        if (s.selectedItem) return s.selectedItem;

        // Return root data from Y.Doc
        const { __readOnly, ...rootProps } = s.pageDocument.getRootPropsJSON();
        return {
          props: rootProps,
          ...(__readOnly ? { readOnly: __readOnly } : {}),
        };
      },
      getComponentConfig: (type?: string) => {
        const { config, selectedItem } = get();
        const rootFields = config.root?.fields || defaultPageFields;

        return type && type !== "root"
          ? config.components[type]
          : selectedItem
          ? config.components[selectedItem.type]
          : ({ ...config.root, fields: rootFields } as ComponentConfig);
      },
      selectedItem: initialAppStore?.state?.ui.itemSelector
        ? blockToComponentData(pageDocument, initialAppStore.state.ui.itemSelector.id)
        : null,
      dispatch: (action: PuckAction) =>
        set((s) => {
          // Always pre-sync Y.Doc to handle external state changes (e.g.
          // appStore.setState). Migrated actions (insert, remove, move,
          // duplicate, reorder) read from the doc during dispatch.
          if (s.pageDocument && s.state.data) {
            s.pageDocument.config = s.config;
            syncDocFromState(s.pageDocument, s.state.data, s.config);
          }

          const dispatch = createReducer({
            appStore: s,
          });

          const state = dispatch(s.state, action);

          // Post-sync for non-migrated actions that modify data through
          // the reducer (replace, replaceRoot, set, setData).
          // Migrated actions already wrote to the doc directly.
          const needsPostSync =
            action.type === "set" ||
            action.type === "setData" ||
            action.type === "replace" ||
            action.type === "replaceRoot";

          if (needsPostSync && s.pageDocument && state.data) {
            syncDocFromState(s.pageDocument, state.data, s.config);
          }

          // Derive selectedItem from Y.Doc after sync
          const selectedItem = state.ui.itemSelector
            ? blockToComponentData(s.pageDocument, state.ui.itemSelector.id)
            : null;

          get().onAction?.(action, state, get().state);

          return { ...s, state, selectedItem };
        }),
      setZoomConfig: (zoomConfig) => set({ zoomConfig }),
      setStatus: (status) => set({ status }),
      setComponentState: (componentState) => set({ componentState }),
      pendingLoadTimeouts: {},
      setComponentLoading: (
        id: string,
        loading: boolean = true,
        defer: number = 0
      ) => {
        const { setComponentState, pendingLoadTimeouts } = get();

        const loadId = generateId();

        const setLoading = () => {
          const { componentState } = get();

          setComponentState({
            ...componentState,
            [id]: {
              ...componentState[id],
              loadingCount: (componentState[id]?.loadingCount || 0) + 1,
            },
          });
        };

        const unsetLoading = () => {
          const { componentState } = get();

          clearTimeout(timeout);

          delete pendingLoadTimeouts[loadId];

          set({ pendingLoadTimeouts });

          setComponentState({
            ...componentState,
            [id]: {
              ...componentState[id],
              loadingCount: Math.max(
                (componentState[id]?.loadingCount || 0) - 1,
                0
              ),
            },
          });
        };

        const timeout = setTimeout(() => {
          if (loading) {
            setLoading();
          } else {
            unsetLoading();
          }

          delete pendingLoadTimeouts[loadId];

          set({ pendingLoadTimeouts });
        }, defer);

        set({
          pendingLoadTimeouts: {
            ...pendingLoadTimeouts,
            [id]: timeout,
          },
        });

        return unsetLoading;
      },
      unsetComponentLoading: (id: string) => {
        const { setComponentLoading } = get();

        setComponentLoading(id, false);
      },
      // Helper
      setUi: (ui: Partial<UiState>, recordHistory?: boolean) =>
        set((s) => {
          const dispatch = createReducer({
            appStore: s,
          });

          const state = dispatch(s.state, {
            type: "setUi",
            ui,
            recordHistory,
          });

          const selectedItem = state.ui.itemSelector
            ? blockToComponentData(s.pageDocument, state.ui.itemSelector.id)
            : null;

          return { ...s, state, selectedItem };
        }),
      resolveComponentData: async (componentData, trigger) => {
        const { config, metadata, setComponentLoading, permissions, pageDocument } =
          get();
        const componentId =
          "id" in componentData.props ? componentData.props.id : "root";

        // Look up parent data from Y.Doc (with nested slot content for resolveData callback)
        const parentInfo = pageDocument.findParent(componentId);
        const parentData = parentInfo
          ? blockToFullComponentData(pageDocument, parentInfo.parentId, config)
          : null;

        const timeouts: Record<string, () => void> = {};

        return await resolveComponentData(
          componentData,
          config,
          metadata,
          (item) => {
            const id = "id" in item.props ? item.props.id : "root";
            timeouts[id] = setComponentLoading(id, true, 50);
          },
          async (item) => {
            const id = "id" in item.props ? item.props.id : "root";

            if ("type" in item) {
              await permissions.refreshPermissions({ item });
            } else {
              await permissions.refreshPermissions({ root: true });
            }

            timeouts[id]();
          },
          trigger,
          parentData
        );
      },
      resolveAndCommitData: async () => {
        const { config, state, resolveComponentData, pageDocument } = get();

        // Ensure Y.Doc is in sync before resolving (called on load, not hot path)
        pageDocument.config = config;
        syncDocFromState(pageDocument, state.data, config);

        walkAppState(
          state,
          config,
          (content) => content,
          (childItem) => {
            resolveComponentData(childItem, "load").then((resolved) => {
              const s = get();

              const blockId = resolved.node.props.id;
              const blockExists = blockId === "root" || !!pageDocument.getBlock(blockId);

              // Ensure node hasn't been deleted whilst resolution happens
              if (blockExists && resolved.didChange) {
                if (resolved.node.props.id === "root") {
                  // Update root props via Y.Doc
                  const { id: _id, ...rootPropsToUpdate } =
                    resolved.node.props ?? {};
                  const rootFields = s.config.root?.fields ?? {};
                  const nonSlotProps: Record<string, any> = {};
                  for (const [k, v] of Object.entries(rootPropsToUpdate)) {
                    if (!(rootFields[k] && rootFields[k].type === "slot")) {
                      nonSlotProps[k] = v;
                    }
                  }
                  pageDocument.updateRootProps(nonSlotProps);
                } else {
                  // Update block props via Y.Doc
                  const { id: _id, ...propsToUpdate } =
                    resolved.node.props;
                  const componentConfig =
                    s.config.components[resolved.node.type];
                  const fields = componentConfig?.fields ?? {};
                  const nonSlotProps: Record<string, any> = {};
                  for (const [k, v] of Object.entries(propsToUpdate)) {
                    if (!(fields[k] && fields[k].type === "slot")) {
                      nonSlotProps[k] = v;
                    }
                  }
                  pageDocument.updateProps(
                    resolved.node.props.id,
                    nonSlotProps
                  );
                }

                // Materialize updated doc to store
                const newState = materializeAppState(
                  pageDocument,
                  s.state.ui,
                  s.config
                );
                const selectedItem = newState.ui.itemSelector
                  ? blockToComponentData(pageDocument, newState.ui.itemSelector.id)
                  : null;

                set({ state: newState, selectedItem });
              }
            });

            return childItem;
          }
        );
      },
    }))
  );
};

export const appStoreContext = createContext(createAppStore());

export function useAppStore<T>(selector: (state: AppStore) => T) {
  const context = useContext(appStoreContext);

  return useStore(context, selector);
}

export function useAppStoreApi() {
  return useContext(appStoreContext);
}

/** Build a ComponentData from a Y.Doc block (for selectedItem derivation). */
function blockToComponentData(doc: PageDocument, id: string): ComponentData | null {
  const block = doc.getBlock(id);
  if (!block) return null;
  return {
    type: block.type,
    props: { ...block.props, id: block.id },
    ...(block.readOnly ? { readOnly: block.readOnly } : {}),
  } as ComponentData;
}

/** Build a full ComponentData with nested slot content from Y.Doc (for resolveData parent). */
function blockToFullComponentData(
  doc: PageDocument,
  id: string,
  config: Config
): ComponentData | null {
  const block = doc.getBlock(id);
  if (!block) return null;

  const componentConfig = config.components[block.type];
  const fields = componentConfig?.fields ?? {};
  const props: Record<string, any> = { ...block.props, id: block.id };

  // Materialize slot content inline (recursive)
  for (const [slotName, childIds] of Object.entries(block.slots)) {
    if (fields[slotName]?.type === "slot") {
      props[slotName] = childIds
        .map((childId) => blockToFullComponentData(doc, childId, config))
        .filter(Boolean);
    }
  }

  return {
    type: block.type,
    props,
    ...(block.readOnly ? { readOnly: block.readOnly } : {}),
  } as ComponentData;
}

/**
 * Materialize the Y.Doc into Zustand state after direct PageDocument mutations.
 * Callers that bypass dispatch (e.g. doc.updateProps) use this to sync the store.
 */
export function commitDocToStore(
  appStoreApi: AppStoreApi,
  options?: {
    onAction?: { type: string; [key: string]: any };
    ui?: Partial<UiState>;
  }
) {
  const s = appStoreApi.getState();
  const ui = options?.ui ? { ...s.state.ui, ...options.ui } : s.state.ui;
  const state = materializeAppState(s.pageDocument, ui, s.config);

  // Derive selectedItem from Y.Doc directly instead of materialized state
  const itemSelector = options?.ui?.itemSelector !== undefined
    ? options.ui.itemSelector
    : s.state.ui.itemSelector;
  const selectedItem = itemSelector
    ? blockToComponentData(s.pageDocument, itemSelector.id)
    : null;

  if (options?.onAction && s.onAction) {
    s.onAction(options.onAction as PuckAction, state, s.state);
  }

  appStoreApi.setState({ state, selectedItem });
}
