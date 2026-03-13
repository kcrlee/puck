import { Loader } from "../../../Loader";
import { ItemSelector } from "../../../../lib/data/get-item";
import { UiState } from "../../../../types";
import { AutoFieldPrivate } from "../../../AutoField";
import { fieldContextStore } from "../../../AutoField/store";
import {
  AppStore,
  useAppStore,
  useAppStoreApi,
  commitDocToStore,
} from "../../../../store";
import styles from "./styles.module.css";
import { getClassNameFactory } from "../../../../lib";
import {
  memo,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from "react";
import { useRegisterFieldsSlice } from "../../../../store/slices/fields";
import { useShallow } from "zustand/react/shallow";
import { StoreApi } from "zustand";

const getClassName = getClassNameFactory("PuckFields", styles);

const DefaultFields = ({
  children,
}: {
  children: ReactNode;
  isLoading: boolean;
  itemSelector?: ItemSelector | null;
}) => {
  return <>{children}</>;
};

const createOnChange =
  (fieldName: string, appStore: StoreApi<AppStore>) =>
  async (value: any, updatedUi?: Partial<UiState>) => {
    const { selectedItem, resolveComponentData, pageDocument } =
      appStore.getState();

    // Read current props from Y.Doc for root, or from selectedItem
    const currentProps = selectedItem
      ? selectedItem.props
      : (() => {
          const { __readOnly, ...rootProps } = pageDocument.getRootPropsJSON();
          return rootProps;
        })();

    const newProps = { ...currentProps, [fieldName]: value };

    if (selectedItem) {
      const resolved = await resolveComponentData(
        { ...selectedItem, props: newProps },
        "replace"
      );

      // Extract only non-slot props for updateProps
      const { id: _id, ...propsToUpdate } = resolved.node.props;
      const componentConfig =
        appStore.getState().config.components[selectedItem.type];
      const fields = componentConfig?.fields ?? {};
      const nonSlotProps: Record<string, any> = {};
      for (const [k, v] of Object.entries(propsToUpdate)) {
        if (!(fields[k] && fields[k].type === "slot")) {
          nonSlotProps[k] = v;
        }
      }

      pageDocument.updateProps(selectedItem.props.id, nonSlotProps);
      commitDocToStore(appStore, {
        onAction: {
          type: "replace",
          data: resolved.node,
          destinationIndex: 0,
          destinationZone: "",
        },
        ui: updatedUi,
      });

      return;
    }

    // Root field change — always uses props-wrapped format with Y.Doc
    const resolved = await resolveComponentData(
      { props: newProps },
      "replace"
    );

    // Extract non-slot root props
    const { id: _id, ...propsToUpdate } = resolved.node.props ?? {};
    const rootFields = appStore.getState().config.root?.fields ?? {};
    const nonSlotProps: Record<string, any> = {};
    for (const [k, v] of Object.entries(propsToUpdate)) {
      if (!(rootFields[k] && rootFields[k].type === "slot")) {
        nonSlotProps[k] = v;
      }
    }

    pageDocument.updateRootProps(nonSlotProps);
    commitDocToStore(appStore, {
      onAction: {
        type: "replaceRoot",
        root: resolved.node,
      },
      ui: updatedUi,
    });
  };

const FieldsChildInner = ({ fieldName }: { fieldName: string }) => {
  const field = useAppStore((s) => s.fields.fields[fieldName]);
  const isReadOnly = useAppStore(
    (s) =>
      ((s.selectedItem
        ? s.selectedItem.readOnly
        : s.pageDocument.getRootPropsJSON().__readOnly) || {})[fieldName]
  );

  const id = useAppStore((s) => {
    if (!field) return null;

    return s.selectedItem
      ? `${s.selectedItem.props.id}_${field.type}_${fieldName}`
      : `root_${field.type}_${fieldName}`;
  });

  const permissions = useAppStore(
    useShallow((s) => {
      const { selectedItem, permissions } = s;

      return selectedItem
        ? permissions.getPermissions({ item: selectedItem })
        : permissions.getPermissions({ root: true });
    })
  );

  const appStore = useAppStoreApi();

  const onChange = useCallback(createOnChange(fieldName, appStore), [
    fieldName,
  ]);

  const { visible = true } = field ?? {};

  const fieldStore = useContext(fieldContextStore.ctx);

  useEffect(() => {
    return appStore.subscribe(
      (s) => {
        const data = s.getCurrentData();

        return data.props?.[fieldName];
      },
      (value) => {
        fieldStore.setState({ [fieldName]: value });
      }
    );
  }, [appStore, fieldStore]);

  if (!field || !id || !visible) return null;

  if (field.type === "slot") return null;

  return (
    <div key={id} className={getClassName("field")}>
      <AutoFieldPrivate
        field={field}
        name={fieldName}
        id={id}
        readOnly={!permissions.edit || isReadOnly}
        onChange={onChange}
      />
    </div>
  );
};

const FieldsChild = ({ fieldName }: { fieldName: string }) => {
  const appStore = useAppStoreApi();

  const initialValue = useMemo(() => {
    const value = appStore.getState().getCurrentData().props?.[fieldName];

    return { [fieldName]: value };
  }, []);

  return (
    <fieldContextStore.Provider value={initialValue}>
      <FieldsChildInner fieldName={fieldName} />
    </fieldContextStore.Provider>
  );
};

const FieldsChildMemo = memo(FieldsChild);

const FieldsInternal = ({ wrapFields = true }: { wrapFields?: boolean }) => {
  const overrides = useAppStore((s) => s.overrides);
  const componentResolving = useAppStore((s) => {
    const loadingCount = s.selectedItem
      ? s.componentState[s.selectedItem.props.id]?.loadingCount
      : s.componentState["root"]?.loadingCount;

    return (loadingCount ?? 0) > 0;
  });
  const itemSelector = useAppStore(useShallow((s) => s.state.ui.itemSelector));
  const id = useAppStore((s) => s.selectedItem?.props.id);
  const appStore = useAppStoreApi();
  useRegisterFieldsSlice(appStore, id);

  const fieldsLoading = useAppStore((s) => s.fields.loading);
  const fieldNames = useAppStore(
    useShallow((s) => {
      if (s.fields.id === id) {
        return Object.keys(s.fields.fields);
      }

      return [];
    })
  );

  const isLoading = fieldsLoading || componentResolving;

  const Wrapper = useMemo(() => overrides.fields || DefaultFields, [overrides]);

  return (
    <form
      className={getClassName({ wrapFields })}
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      <Wrapper isLoading={isLoading} itemSelector={itemSelector}>
        {fieldNames.map((fieldName) => (
          <FieldsChildMemo key={fieldName} fieldName={fieldName} />
        ))}
      </Wrapper>
      {isLoading && (
        <div className={getClassName("loadingOverlay")}>
          <div className={getClassName("loadingOverlayInner")}>
            <Loader size={16} />
          </div>
        </div>
      )}
    </form>
  );
};

export const Fields = memo(FieldsInternal);
