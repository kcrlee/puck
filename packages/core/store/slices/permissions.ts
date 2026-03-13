import { useEffect } from "react";
import { ComponentData, Config, Permissions, UserGenerics } from "../../types";
import { getChanged } from "../../lib/get-changed";
import { AppStore, useAppStoreApi } from "../";
import {
  blockToComponentData,
  blockToFullComponentData,
} from "../../crdt/block-data";


type PermissionsArgs<
  UserConfig extends Config = Config,
  G extends UserGenerics<UserConfig> = UserGenerics<UserConfig>
> = {
  item?: G["UserComponentData"] | null;
  type?: keyof G["UserProps"];
  root?: boolean;
};

export type GetPermissions<UserConfig extends Config = Config> = (
  params?: PermissionsArgs<UserConfig>
) => Permissions;

type ResolvePermissions<UserConfig extends Config = Config> = (
  params?: PermissionsArgs<UserConfig>,
  force?: boolean
) => void;

export type RefreshPermissions<UserConfig extends Config = Config> = (
  params?: PermissionsArgs<UserConfig>,
  force?: boolean
) => void;

type Cache = Record<
  string,
  {
    lastPermissions: Partial<Permissions>;
    lastData: ComponentData | null;
    lastParentId: string | null;
  }
>;

export type PermissionsSlice = {
  cache: Cache;
  globalPermissions: Permissions;
  resolvedPermissions: Record<string, Partial<Permissions> | undefined>;
  getPermissions: GetPermissions<Config>;
  resolvePermissions: ResolvePermissions<Config>;
  refreshPermissions: RefreshPermissions<Config>;
};

export const createPermissionsSlice = (
  set: (newState: Partial<AppStore>) => void,
  get: () => AppStore
): PermissionsSlice => {
  const resolvePermissions: ResolvePermissions = async (params = {}, force) => {
    const { permissions, config, pageDocument } = get();
    const { cache, globalPermissions } = permissions;

    pageDocument.config = config;

    const resolvePermissionsForItem = async (
      item: ComponentData,
      force: boolean = false
    ) => {
      const { config, state: appState, setComponentLoading, pageDocument } = get();
      const itemCache: Cache[string] | undefined = cache[item.props.id];
      // Parent lookup from Y.Doc
      const parentInfo = pageDocument.findParent(item.props.id);
      const parentId = parentInfo?.parentId ?? null;
      let parentData: ComponentData | null = null;
      if (parentId) {
        parentData = blockToFullComponentData(pageDocument, parentId, config);
      } else if (pageDocument.getLocation(item.props.id)) {
        // Root-level block — synthetic root parent
        const rootProps = pageDocument.getRootPropsJSON();
        const { __readOnly, ...rootPropsClean } = rootProps;
        parentData = {
          type: "root",
          props: { ...rootPropsClean, id: "root" },
        } as ComponentData;
      }

      const componentConfig =
        item.type === "root" ? config.root : config.components[item.type];

      if (!componentConfig) {
        return;
      }

      const initialPermissions = {
        ...globalPermissions,
        ...componentConfig.permissions,
      };

      if (componentConfig.resolvePermissions) {
        const changed = getChanged(item, itemCache?.lastData);
        const propsChanged = Object.values(changed).some((el) => el === true);
        const parentChanged = itemCache?.lastParentId !== parentId;

        if (propsChanged || parentChanged || force) {
          const clearTimeout = setComponentLoading(item.props.id, true, 50);

          const resolvedPermissions = await componentConfig.resolvePermissions(
            item,
            {
              changed,
              lastPermissions: itemCache?.lastPermissions || null,
              permissions: initialPermissions,
              appState: { data: pageDocument.toPuckDataCached(), ui: appState.ui },
              lastData: itemCache?.lastData || null,
              parent: parentData,
            }
          );

          const latest = get().permissions;

          set({
            permissions: {
              ...latest,
              cache: {
                ...latest.cache,
                [item.props.id]: {
                  lastParentId: parentId,
                  lastData: item,
                  lastPermissions: resolvedPermissions,
                },
              },
              resolvedPermissions: {
                ...latest.resolvedPermissions,
                [item.props.id]: resolvedPermissions,
              },
            },
          });

          clearTimeout();
        }
      }
    };

    const resolvePermissionsForRoot = (force = false) => {
      const { pageDocument: doc } = get();
      const rootProps = doc.getRootPropsJSON();
      const { __readOnly, ...rootPropsClean } = rootProps;

      resolvePermissionsForItem(
        {
          type: "root",
          props: { ...rootPropsClean, id: "root" },
        },
        force
      );
    };

    const { item, type, root } = params;

    if (item) {
      // Resolve specific item
      await resolvePermissionsForItem(item, force);
    } else if (type) {
      // Resolve specific type — iterate Y.Doc blocks directly
      if (type === "root") {
        resolvePermissionsForRoot(force);
      } else {
        const { pageDocument: doc } = get();
        for (const id of doc.getAllBlockIds()) {
          const block = doc.getBlock(id);
          if (!block || block.type === "__dropzone_stub") continue;
          if (block.type !== type) continue;
          const blockData = blockToComponentData(doc, id);
          if (blockData) await resolvePermissionsForItem(blockData, force);
        }
      }
    } else if (root) {
      resolvePermissionsForRoot(force);
    } else {
      // Resolve everything — iterate Y.Doc blocks + root
      const { pageDocument: doc } = get();
      for (const id of doc.getAllBlockIds()) {
        const block = doc.getBlock(id);
        if (!block || block.type === "__dropzone_stub") continue;
        const blockData = blockToComponentData(doc, id);
        if (blockData) await resolvePermissionsForItem(blockData, force);
      }
      resolvePermissionsForRoot(force);
    }
  };

  const refreshPermissions: RefreshPermissions = (params) =>
    resolvePermissions(params, true);

  return {
    cache: {},
    globalPermissions: {
      drag: true,
      edit: true,
      delete: true,
      duplicate: true,
      insert: true,
    },
    resolvedPermissions: {},
    getPermissions: ({ item, type, root } = {}) => {
      const { config, permissions } = get();
      const { globalPermissions, resolvedPermissions } = permissions;

      if (item) {
        const componentConfig = config.components[item.type];

        const initialPermissions = {
          ...globalPermissions,
          ...componentConfig?.permissions,
        };

        const resolvedForItem = resolvedPermissions[item.props.id];

        return (
          resolvedForItem
            ? { ...globalPermissions, ...resolvedForItem }
            : initialPermissions
        ) as Permissions;
      } else if (type) {
        const componentConfig = config.components[type];

        return {
          ...globalPermissions,
          ...componentConfig?.permissions,
        } as Permissions;
      } else if (root) {
        const rootConfig = config.root;

        const initialPermissions = {
          ...globalPermissions,
          ...rootConfig?.permissions,
        } as Permissions;

        const resolvedForItem = resolvedPermissions["root"];

        return (
          resolvedForItem
            ? { ...globalPermissions, ...resolvedForItem }
            : initialPermissions
        ) as Permissions;
      }

      return globalPermissions;
    },
    resolvePermissions,
    refreshPermissions,
  };
};

export const useRegisterPermissionsSlice = (
  appStore: ReturnType<typeof useAppStoreApi>,
  globalPermissions: Partial<Permissions>
) => {
  useEffect(() => {
    const { permissions } = appStore.getState();
    const { globalPermissions: existingGlobalPermissions } = permissions;
    appStore.setState({
      permissions: {
        ...permissions,
        globalPermissions: {
          ...existingGlobalPermissions,
          ...globalPermissions,
        } as Permissions,
      },
    });

    permissions.resolvePermissions();
  }, [globalPermissions]);

  useEffect(() => {
    const doc = appStore.getState().pageDocument;
    let pending = false;
    return doc.subscribe(() => {
      if (pending) return;
      pending = true;
      // Defer to microtask to collapse multiple synchronous Y.Doc events
      // (e.g. dispatch pre-sync + action handler sync) into one call
      queueMicrotask(() => {
        pending = false;
        appStore.getState().permissions.resolvePermissions();
      });
    });
  }, []);

  useEffect(() => {
    return appStore.subscribe(
      (s) => s.config,
      () => {
        appStore.getState().permissions.resolvePermissions();
      }
    );
  }, []);
};
