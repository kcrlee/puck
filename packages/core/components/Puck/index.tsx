/* eslint-disable react-hooks/rules-of-hooks */
import {
  Context,
  createContext,
  CSSProperties,
  PropsWithChildren,
  ReactElement,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  UiState,
  IframeConfig,
  OnAction,
  Overrides,
  Permissions,
  Plugin,
  UserGenerics,
  Config,
  Data,
  Metadata,
  AsFieldProps,
  DefaultComponentProps,
} from "../../types";

import { PuckAction } from "../../reducer";
import { createAppStore, defaultAppState, appStoreContext } from "../../store";
import { Fields } from "./components/Fields";
import { Components } from "./components/Components";
import { Preview } from "./components/Preview";
import { Outline } from "./components/Outline";
import { defaultViewports } from "../ViewportControls/default-viewports";
import { Viewports } from "../../types";
import { useLoadedOverrides } from "../../lib/use-loaded-overrides";
import { useRegisterHistorySlice } from "../../store/slices/history";
import { useRegisterPermissionsSlice } from "../../store/slices/permissions";
import {
  UsePuckStoreContext,
  useRegisterUsePuckStore,
} from "../../lib/use-puck";
import { PrivateAppState } from "../../types/Internal";
import { deepEqual } from "fast-equals";
import { FieldTransforms } from "../../types/API/FieldTransforms";
import { populateIds } from "../../lib/data/populate-ids";
import { toComponent } from "../../lib/data/to-component";
import { Layout } from "./components/Layout";
import { useSafeId } from "../../lib/use-safe-id";
import { PageDocumentProvider } from "../../crdt/context";

type PuckProps<
  UserConfig extends Config = Config,
  G extends UserGenerics<UserConfig> = UserGenerics<UserConfig>
> = {
  children?: ReactNode;
  config: UserConfig;
  data: Partial<G["UserData"] | Data>;
  ui?: Partial<UiState>;
  onChange?: (data: G["UserData"]) => void;
  onPublish?: (data: G["UserData"]) => void;
  onAction?: OnAction<G["UserData"]>;
  permissions?: Partial<Permissions>;
  plugins?: Plugin<UserConfig>[];
  overrides?: Partial<Overrides<UserConfig>>;
  fieldTransforms?: FieldTransforms<UserConfig>;
  renderHeader?: (props: {
    children: ReactNode;
    dispatch: (action: PuckAction) => void;
    state: G["UserAppState"];
  }) => ReactElement;
  renderHeaderActions?: (props: {
    state: G["UserAppState"];
    dispatch: (action: PuckAction) => void;
  }) => ReactElement;
  headerTitle?: string;
  headerPath?: string;
  viewports?: Viewports;
  iframe?: IframeConfig;
  dnd?: {
    disableAutoScroll?: boolean;
  };
  metadata?: Metadata;
  height?: CSSProperties["height"];
  _experimentalFullScreenCanvas?: boolean;
};

const propsContext = createContext<Partial<PuckProps>>({});

function PropsProvider<UserConfig extends Config = Config>(
  props: PuckProps<UserConfig>
) {
  return (
    <propsContext.Provider value={props as PuckProps}>
      {props.children}
    </propsContext.Provider>
  );
}

export const usePropsContext = () =>
  useContext<PuckProps>(propsContext as Context<PuckProps>);

function PuckProvider<
  UserConfig extends Config = Config,
  G extends UserGenerics<UserConfig> = UserGenerics<UserConfig>
>({ children }: PropsWithChildren) {
  const {
    config,
    data: initialData,
    ui: initialUi,
    onChange,
    permissions = {},
    plugins,
    overrides,
    viewports = defaultViewports,
    iframe: _iframe,
    metadata,
    onAction,
    fieldTransforms,
  } = usePropsContext();

  const iframe: IframeConfig = useMemo(
    () => ({
      enabled: true,
      waitForStyles: true,
      ..._iframe,
    }),
    [_iframe]
  );

  const [generatedAppState] = useState<G["UserAppState"]>(() => {
    const initial = { ...defaultAppState.ui, ...initialUi };

    let clientUiState: Partial<G["UserAppState"]["ui"]> = {};

    // DEPRECATED
    if (
      Object.keys(initialData?.root || {}).length > 0 &&
      !initialData?.root?.props
    ) {
      console.warn(
        "Warning: Defining props on `root` is deprecated. Please use `root.props`, or republish this page to migrate automatically."
      );
    }

    // Deprecated
    const rootProps = initialData?.root?.props || initialData?.root || {};

    const defaultedRootProps = {
      ...config.root?.defaultProps,
      ...(rootProps as AsFieldProps<DefaultComponentProps> | AsFieldProps<any>),
    };

    const root = populateIds(
      toComponent({ ...initialData?.root, props: defaultedRootProps }),
      config
    );

    const newAppState = {
      ...defaultAppState,
      data: {
        ...initialData,
        root: { ...initialData?.root, props: root.props },
        content: initialData.content || [],
      },
      ui: {
        ...initial,
        ...clientUiState,
        // Store categories under componentList on state to allow render functions and plugins to modify
        componentList: config.categories
          ? Object.entries(config.categories).reduce(
              (acc, [categoryName, category]) => {
                return {
                  ...acc,
                  [categoryName]: {
                    title: category.title,
                    components: category.components,
                    expanded: category.defaultExpanded,
                    visible: category.visible,
                  },
                };
              },
              {}
            )
          : {},
      },
    } as G["UserAppState"];

    // Y.Doc (created in createAppStore) is the authoritative data source.
    // Indexes are empty — all consumers read from Y.Doc directly.
    return {
      ...newAppState,
      indexes: { nodes: {}, zones: {} },
    } as PrivateAppState;
  });

  const initialAppState = generatedAppState;

  // Load all plugins into the overrides
  const loadedOverrides = useLoadedOverrides({
    overrides: overrides,
    plugins: plugins,
  });

  const loadedFieldTransforms = useMemo(() => {
    const _plugins: Plugin[] = plugins || [];
    const pluginFieldTransforms = _plugins.reduce<FieldTransforms>(
      (acc, plugin) => ({ ...acc, ...plugin.fieldTransforms }),
      {}
    );

    return {
      ...pluginFieldTransforms,
      ...fieldTransforms,
    };
  }, [fieldTransforms, plugins]);

  const instanceId = useSafeId();

  const generateAppStore = useCallback(
    (state?: PrivateAppState) => {
      return {
        instanceId,
        state,
        config,
        plugins: plugins || [],
        overrides: loadedOverrides,
        viewports,
        iframe,
        onAction,
        metadata,
        fieldTransforms: loadedFieldTransforms,
      };
    },
    [
      instanceId,
      initialAppState,
      config,
      plugins,
      loadedOverrides,
      viewports,
      iframe,
      onAction,
      onChange,
      metadata,
      loadedFieldTransforms,
    ]
  );

  const [appStore] = useState(() =>
    createAppStore(generateAppStore(initialAppState))
  );

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      (window as any).__PUCK_INTERNAL_DO_NOT_USE = { appStore };
    }
  }, [appStore]);

  useEffect(() => {
    const state = appStore.getState().state;

    appStore.setState({
      ...generateAppStore(state),
    });
  }, [config, plugins, loadedOverrides, viewports, iframe, onAction, onChange, metadata]);

  useRegisterHistorySlice(appStore);

  const previousData = useRef<Data>(null);

  // Subscribe to Y.Doc changes for onChange (source of truth, not state.data)
  useEffect(() => {
    if (!onChange) return;
    const doc = appStore.getState().pageDocument;

    return doc.subscribe(() => {
      const data = doc.toPuckDataCached();
      if (deepEqual(data, previousData.current)) return;

      onChange(data as G["UserData"]);
      previousData.current = data;
    });
  }, [onChange]);

  useRegisterPermissionsSlice(appStore, permissions);

  const uPuckStore = useRegisterUsePuckStore(appStore);

  useEffect(() => {
    const { resolveAndCommitData } = appStore.getState();

    resolveAndCommitData();
  }, []);

  return (
    <appStoreContext.Provider value={appStore}>
      <PageDocumentProvider document={appStore.getState().pageDocument}>
        <UsePuckStoreContext.Provider value={uPuckStore}>
          {children}
        </UsePuckStoreContext.Provider>
      </PageDocumentProvider>
    </appStoreContext.Provider>
  );
}

export function Puck<
  UserConfig extends Config = Config,
  G extends UserGenerics<UserConfig> = UserGenerics<UserConfig>
>(props: PuckProps<UserConfig>) {
  return (
    <PropsProvider {...props}>
      <PuckProvider {...props}>
        <Layout>{props.children}</Layout>
      </PuckProvider>
    </PropsProvider>
  );
}

Puck.Components = Components;
Puck.Fields = Fields;
Puck.Layout = Layout;
Puck.Outline = Outline;
Puck.Preview = Preview;
