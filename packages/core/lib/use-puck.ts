import {
  Config,
  UserGenerics,
  ResolveDataTrigger,
  ComponentData,
} from "../types";
import { createContext, useContext, useEffect, useState } from "react";
import { AppStore, AppStoreApi, useAppStoreApi } from "../store";
import { blockToComponentData } from "../crdt/block-data";
import {
  GetPermissions,
  RefreshPermissions,
} from "../store/slices/permissions";
import { HistorySlice } from "../store/slices/history";
import { createStore, StoreApi, useStore } from "zustand";
import { ItemSelector } from "./data/get-item";
import { resolveDataById } from "./data/resolve-data-by-id";
import { resolveDataBySelector } from "./data/resolve-data-by-selector";
import { getSelectorForId } from "./get-selector-for-id";

export type UsePuckData<
  UserConfig extends Config = Config,
  G extends UserGenerics<UserConfig> = UserGenerics<UserConfig>
> = {
  appState: G["UserPublicAppState"];
  config: UserConfig;
  dispatch: AppStore["dispatch"];
  getPermissions: GetPermissions<UserConfig>;
  refreshPermissions: RefreshPermissions<UserConfig>;
  resolveDataById: (id: string, trigger?: ResolveDataTrigger) => void;
  resolveDataBySelector: (
    selector: ItemSelector,
    trigger?: ResolveDataTrigger
  ) => void;
  selectedItem: G["UserComponentData"] | null;
  getItemBySelector: (
    selector: ItemSelector
  ) => G["UserComponentData"] | undefined;
  getItemById: (id: string) => G["UserComponentData"] | undefined;
  getSelectorForId: (id: string) => ItemSelector | undefined;
  getParentById: (id: string) => ComponentData | undefined;
  history: {
    back: HistorySlice["back"];
    forward: HistorySlice["forward"];
    hasPast: boolean;
    hasFuture: boolean;
  };
};

export type PuckApi<UserConfig extends Config = Config> =
  UsePuckData<UserConfig>;

type UsePuckStore<UserConfig extends Config = Config> = PuckApi<UserConfig>;

type PickedStore = Pick<
  AppStore,
  "config" | "dispatch" | "selectedItem" | "permissions" | "history" | "state"
>;

export const generateUsePuck = (
  store: PickedStore,
  appStoreApi: AppStoreApi
): UsePuckStore => {
  const history: UsePuckStore["history"] = {
    back: store.history.back,
    forward: store.history.forward,
    hasPast: store.history.hasPast(),
    hasFuture: store.history.hasFuture(),
  };

  const doc = appStoreApi.getState().pageDocument;
  const storeData: PuckApi = {
    appState: { data: doc.toPuckDataCached(), ui: store.state.ui },
    config: store.config,
    dispatch: store.dispatch,
    getPermissions: store.permissions.getPermissions,
    refreshPermissions: store.permissions.refreshPermissions,
    resolveDataById: (id, trigger) => resolveDataById(id, appStoreApi, trigger),
    resolveDataBySelector: (selector, trigger) =>
      resolveDataBySelector(selector, appStoreApi, trigger),
    history,
    selectedItem: store.selectedItem || null,
    getItemBySelector: (selector) => {
      const doc = appStoreApi.getState().pageDocument;
      return blockToComponentData(doc, selector.id) ?? undefined;
    },
    getItemById: (id) => {
      const doc = appStoreApi.getState().pageDocument;
      return blockToComponentData(doc, id) ?? undefined;
    },
    getSelectorForId: (id) => getSelectorForId(appStoreApi.getState().pageDocument, id),
    getParentById: (id) => {
      const doc = appStoreApi.getState().pageDocument;
      const parentInfo = doc.findParent(id);
      if (!parentInfo) return;
      return blockToComponentData(doc, parentInfo.parentId) ?? undefined;
    },
  };

  (storeData as any).__private = {
    appState: store.state,
  };

  return storeData;
};

export const UsePuckStoreContext = createContext<StoreApi<UsePuckStore> | null>(
  null
);

const convertToPickedStore = (store: AppStore): PickedStore => {
  return {
    state: store.state,
    config: store.config,
    dispatch: store.dispatch,
    permissions: store.permissions,
    history: store.history,
    selectedItem: store.selectedItem,
  };
};

/**
 * Mirror changes in appStore to usePuckStore
 */
export const useRegisterUsePuckStore = (
  appStore: ReturnType<typeof useAppStoreApi>
) => {
  const [usePuckStore] = useState(() =>
    createStore(() =>
      generateUsePuck(
        convertToPickedStore(appStore.getState()),
        appStore
      )
    )
  );

  useEffect(() => {
    // Subscribe here isn't doing anything as selection isn't shallow
    return appStore.subscribe(
      (store) => convertToPickedStore(store),
      (pickedStore) => {
        usePuckStore.setState(generateUsePuck(pickedStore, appStore));
      }
    );
  }, []);

  return usePuckStore;
};

/**
 * createUsePuck
 *
 * Create a typed usePuck hook, which is necessary because the user may provide a generic type but not
 * a selector type, and TS does not currently support partial inference.
 * Related: https://github.com/microsoft/TypeScript/issues/26242
 *
 * @returns a typed usePuck function
 */
export function createUsePuck<UserConfig extends Config = Config>() {
  return function usePuck<T = PuckApi<UserConfig>>(
    selector: (state: UsePuckStore<UserConfig>) => T
  ): T {
    const usePuckApi = useContext(UsePuckStoreContext);

    if (!usePuckApi) {
      throw new Error("usePuck must be used inside <Puck>.");
    }

    const result = useStore(
      usePuckApi as unknown as StoreApi<UsePuckStore<UserConfig>>,
      selector ?? ((s) => s as T)
    );

    return result;
  };
}

export function usePuck<UserConfig extends Config = Config>() {
  useEffect(() => {
    console.warn(
      "You're using the `usePuck` method without a selector, which may cause unnecessary re-renders. Replace with `createUsePuck` and provide a selector for improved performance."
    );
  }, []);

  return createUsePuck<UserConfig>()((s) => s);
}

/**
 * Get the latest state without relying on a render
 *
 * @returns PuckApi
 */
export function useGetPuck() {
  const usePuckApi = useContext(UsePuckStoreContext);

  if (!usePuckApi) {
    throw new Error("usePuckGet must be used inside <Puck>.");
  }

  return usePuckApi.getState;
}
