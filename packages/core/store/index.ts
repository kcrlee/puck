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

import { generateId } from "../lib/generate-id";
import { defaultAppState } from "./default-app-state";
import { FieldTransforms } from "../types/API/FieldTransforms";
import type { Editor } from "@tiptap/react";
import { PageDocument } from "../crdt/PageDocument";
import {
  blockToComponentData,
  blockToFullComponentData,
} from "../crdt/block-data";

export { defaultAppState };
export { blockToComponentData } from "../crdt/block-data";

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
          s.pageDocument.config = s.config;

          const dispatch = createReducer({
            appStore: s,
          });

          const state = dispatch(s.state, action);

          // Derive selectedItem from Y.Doc after dispatch
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
        const { config, resolveComponentData, pageDocument } = get();

        pageDocument.config = config;

        const commitResolved = (resolved: { node: ComponentData | RootDataWithProps; didChange: boolean }) => {
          const s = get();
          const props = resolved.node.props as Record<string, any>;
          const blockId = props.id as string;
          const isRoot = blockId === "root";
          const blockExists = isRoot || !!pageDocument.getBlock(blockId);

          if (blockExists && resolved.didChange) {
            const { id: _id, ...propsToUpdate } = props;

            if (isRoot) {
              const rootFields = s.config.root?.fields ?? {};
              const nonSlotProps: Record<string, any> = {};
              for (const [k, v] of Object.entries(propsToUpdate)) {
                if (!(rootFields[k] && rootFields[k].type === "slot")) {
                  nonSlotProps[k] = v;
                }
              }
              pageDocument.updateRootProps(nonSlotProps);
            } else {
              const componentConfig =
                s.config.components[(resolved.node as ComponentData).type];
              const fields = componentConfig?.fields ?? {};
              const nonSlotProps: Record<string, any> = {};
              for (const [k, v] of Object.entries(propsToUpdate)) {
                if (!(fields[k] && fields[k].type === "slot")) {
                  nonSlotProps[k] = v;
                }
              }
              pageDocument.updateProps(blockId, nonSlotProps);
            }

            const newState = {
              data: pageDocument.toPuckData(),
              ui: s.state.ui,
              indexes: { nodes: {}, zones: {} },
            };
            const selectedItem = newState.ui.itemSelector
              ? blockToComponentData(pageDocument, newState.ui.itemSelector.id)
              : null;

            set({ state: newState, selectedItem });
          }
        };

        // Resolve all blocks from Y.Doc directly (no walkAppState needed)
        for (const id of pageDocument.getAllBlockIds()) {
          const block = pageDocument.getBlock(id);
          if (!block || block.type === "__dropzone_stub") continue;

          const componentData = blockToFullComponentData(pageDocument, id, config);
          if (!componentData) continue;

          resolveComponentData(componentData, "load").then(commitResolved);
        }

        // Resolve root
        const rootFields = config.root?.fields ?? {};
        const rootProps = pageDocument.getRootPropsJSON();
        const { __readOnly, ...rootPropsClean } = rootProps;

        // Materialize root slot children inline for resolver callback
        for (const [fieldName, fieldDef] of Object.entries(rootFields)) {
          if (fieldDef.type === "slot") {
            const childIds = pageDocument.getSlotChildren("root", fieldName);
            rootPropsClean[fieldName] = childIds
              .map(childId => blockToFullComponentData(pageDocument, childId, config))
              .filter(Boolean);
          }
        }

        const rootData = {
          type: "root",
          props: { ...rootPropsClean, id: "root" },
          ...(__readOnly ? { readOnly: __readOnly } : {}),
        } as ComponentData;

        resolveComponentData(rootData, "load").then(commitResolved);
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


/**
 * Sync Zustand state after direct PageDocument mutations.
 * Callers that bypass dispatch (e.g. doc.updateProps) use this to update
 * UI state and fire onAction callbacks.
 *
 * Data is always read from Y.Doc (source of truth). state.data is written
 * only when onAction needs it; otherwise state.ui is the only update.
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

  // Derive selectedItem from Y.Doc directly (cheap)
  const itemSelector = options?.ui?.itemSelector !== undefined
    ? options.ui.itemSelector
    : s.state.ui.itemSelector;
  const selectedItem = itemSelector
    ? blockToComponentData(s.pageDocument, itemSelector.id)
    : null;

  if (options?.onAction && s.onAction) {
    // Materialize state for onAction callback
    const state = {
      data: s.pageDocument.toPuckData(),
      ui,
      indexes: { nodes: {}, zones: {} },
    };
    s.onAction(options.onAction as PuckAction, state, s.state);
    appStoreApi.setState({ state, selectedItem });
  } else {
    // Cheap path: only update ui + selectedItem
    const state = { ...s.state, ui };
    appStoreApi.setState({ state, selectedItem });
  }
}
