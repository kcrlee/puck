"use client";

import { useMemo } from "react";
import { useAppStore } from "../../store";
import { useBlock, useSlotChildren } from "../../crdt/hooks";
import { ComponentData, WithPuckProps } from "../../types";
import { useSlots } from "../../lib/use-slots";
import { useRichtextProps } from "../RichTextEditor/lib/use-richtext-props";
export * from "./server";

/**
 * Renders a single block from Y.Doc, applying slot transforms that
 * recursively create ContextSlotRender for nested slots.
 */
const ContextSlotRenderItem = ({
  blockId,
}: {
  blockId: string;
}) => {
  const block = useBlock(blockId);
  const config = useAppStore((s) => s.config);
  const metadata = useAppStore((s) => s.metadata);

  // Build a ComponentData from Y.Doc block, with empty arrays for slot fields
  // (the slot transform replaces these with ContextSlotRender components)
  const item = useMemo(() => {
    if (!block) return null;

    const componentConfig = config.components[block.type];
    const fields = componentConfig?.fields ?? {};
    const props: Record<string, any> = { ...block.props, id: block.id };

    // Slot fields need placeholder values for useSlots to find and transform them
    for (const [fieldName, fieldDef] of Object.entries(fields)) {
      if (fieldDef.type === "slot") {
        props[fieldName] = [];
      }
    }

    return { type: block.type, props } as ComponentData;
  }, [block, config]);

  if (!item) return null;

  const Component = config.components[item.type];
  if (!Component) return null;

  // useSlots applies slot transform: replaces slot field values with
  // ContextSlotRender components that lazily fetch content from Y.Doc
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const props = useSlots(
    config,
    item,
    // Render function for slots: creates ContextSlotRender that fetches from Y.Doc
    (slotProps) => (
      <ContextSlotRender componentId={blockId} zone={slotProps.zone} />
    )
  ) as WithPuckProps<ComponentData["props"]>;

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const richtextProps = useRichtextProps(Component.fields, props);

  return (
    <Component.render
      {...props}
      {...richtextProps}
      puck={{
        ...props.puck,
        metadata: { ...metadata, ...Component.metadata },
      }}
    />
  );
};

export const ContextSlotRender = ({
  componentId,
  zone,
}: {
  componentId: string;
  zone: string;
}) => {
  // Read content IDs from Y.Doc for granular reactivity
  const contentIds = useSlotChildren(componentId, zone);

  return (
    <>
      {contentIds.map((blockId) => (
        <ContextSlotRenderItem key={blockId} blockId={blockId} />
      ))}
    </>
  );
};
