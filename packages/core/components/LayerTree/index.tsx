/* eslint-disable react-hooks/rules-of-hooks */
import styles from "./styles.module.css";
import getClassNameFactory from "../../lib/get-class-name-factory";
import { ComponentConfig } from "../../types";
import { ItemSelector } from "../../lib/data/get-item";
import { scrollIntoView } from "../../lib/scroll-into-view";
import { ChevronDown, LayoutGrid, Layers, Type } from "lucide-react";
import { rootAreaId, rootDroppableId } from "../../lib/root-droppable-id";
import { useCallback, useContext, useMemo } from "react";
import { ZoneStoreContext } from "../DropZone/context";
import { getFrame } from "../../lib/get-frame";
import { onScrollEnd } from "../../lib/on-scroll-end";
import { useAppStore } from "../../store";
import { useContextStore } from "../../lib/use-context-store";
import { useBlock, useSlotChildren } from "../../crdt/hooks";
import { usePageDocument } from "../../crdt/context";

const getClassName = getClassNameFactory("LayerTree", styles);
const getClassNameLayer = getClassNameFactory("Layer", styles);

const Layer = ({
  itemId,
}: {
  itemId: string;
}) => {
  const config = useAppStore((s) => s.config);
  const dispatch = useAppStore((s) => s.dispatch);

  const setItemSelector = useCallback(
    (itemSelector: ItemSelector | null) => {
      dispatch({ type: "setUi", ui: { itemSelector } });
    },
    [dispatch]
  );

  const selecedItemId = useAppStore((s) => s.selectedItem?.props.id);

  const isSelected = selecedItemId === itemId;

  const block = useBlock(itemId);

  // Derive zone compounds from block's slot names (O(1) vs scanning all zones)
  const zonesForItem = useMemo(
    () =>
      block
        ? Object.keys(block.slots).map((slotName) => `${itemId}:${slotName}`)
        : [],
    [block, itemId]
  );

  const containsZone = zonesForItem.length > 0;

  const zoneStore = useContext(ZoneStoreContext);
  const isHovering = useContextStore(
    ZoneStoreContext,
    (s) => s.hoveringComponent === itemId
  );

  const doc = usePageDocument();
  const childIsSelected = useAppStore((s) => {
    const selectedId = s.selectedItem?.props.id;
    if (!selectedId) return false;

    // Walk up the ancestor chain via Y.Doc parent index
    let ancestor = doc.findParent(selectedId);
    while (ancestor) {
      if (ancestor.parentId === itemId) return true;
      ancestor = doc.findParent(ancestor.parentId);
    }
    return false;
  });

  const blockType = block?.type ?? "";
  const componentConfig: ComponentConfig | undefined =
    config.components[blockType];
  const label = componentConfig?.["label"] ?? blockType;

  return (
    <li
      className={getClassNameLayer({
        isSelected,
        isHovering,
        containsZone,
        childIsSelected,
      })}
    >
      <div className={getClassNameLayer("inner")}>
        <button
          type="button"
          className={getClassNameLayer("clickable")}
          onClick={() => {
            if (isSelected) {
              setItemSelector(null);
              return;
            }

            const frame = getFrame();

            const el = frame?.querySelector(
              `[data-puck-component="${itemId}"]`
            );

            if (!el) {
              setItemSelector({ id: itemId });
              return;
            }

            scrollIntoView(el as HTMLElement);

            onScrollEnd(frame, () => {
              setItemSelector({ id: itemId });
            });
          }}
          onMouseEnter={(e) => {
            e.stopPropagation();
            zoneStore.setState({ hoveringComponent: itemId });
          }}
          onMouseLeave={(e) => {
            e.stopPropagation();
            zoneStore.setState({ hoveringComponent: null });
          }}
        >
          {containsZone && (
            <div
              className={getClassNameLayer("chevron")}
              title={isSelected ? "Collapse" : "Expand"}
            >
              <ChevronDown size="12" />
            </div>
          )}
          <div className={getClassNameLayer("title")}>
            <div className={getClassNameLayer("icon")}>
              {blockType === "Text" ||
              blockType === "Heading" ? (
                <Type size="16" />
              ) : (
                <LayoutGrid size="16" />
              )}
            </div>
            <div className={getClassNameLayer("name")}>{label}</div>
          </div>
        </button>
      </div>
      {containsZone &&
        zonesForItem.map((subzone) => (
          <div key={subzone} className={getClassNameLayer("zones")}>
            <LayerTree zoneCompound={subzone} />
          </div>
        ))}
    </li>
  );
};

export const LayerTree = ({
  label: _label,
  zoneCompound,
}: {
  label?: string;
  zoneCompound: string;
}) => {
  const [parentId, slotId] = zoneCompound.split(":");

  // Use slot label if provided, otherwise derive from config
  // useBlock("root") returns null (root is not a regular block), which is fine — falls through to s.config.root
  const parentBlock = useBlock(parentId);
  const label = useAppStore((s) => {
    if (_label) return _label;

    if (zoneCompound === rootDroppableId) return;

    const componentType = parentBlock?.type;

    const configForComponent =
      componentType && componentType !== rootAreaId
        ? s.config.components[componentType]
        : s.config.root;

    return configForComponent?.fields?.[slotId]?.label ?? slotId;
  });

  // Read content IDs from Y.Doc for granular reactivity
  const contentIds = useSlotChildren(parentId, slotId || "default-zone");

  return (
    <>
      {label && (
        <div className={getClassName("zoneTitle")}>
          <div className={getClassName("zoneIcon")}>
            <Layers size="16" />
          </div>
          {label}
        </div>
      )}
      <ul className={getClassName()}>
        {contentIds.length === 0 && (
          <div className={getClassName("helper")}>No items</div>
        )}
        {contentIds.map((itemId) => {
          return (
            <Layer
              itemId={itemId}
              key={itemId}
            />
          );
        })}
      </ul>
    </>
  );
};
