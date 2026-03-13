"use client";

import { memo, useEffect, useRef, useState } from "react";
import { registerOverlayPortal } from "../../lib/overlay-portal";
import { useAppStoreApi, commitDocToStore } from "../../store";
import styles from "./styles.module.css";
import { getClassNameFactory } from "../../lib";
import { setDeep } from "../../lib/data/set-deep";

const getClassName = getClassNameFactory("InlineTextField", styles);

const InlineTextFieldInternal = ({
  propPath,
  componentId,
  value,
  isReadOnly,
  opts = {},
}: {
  propPath: string;
  value: string;
  componentId: string;
  isReadOnly: boolean;
  opts?: { disableLineBreaks?: boolean };
}) => {
  const ref = useRef<HTMLHeadingElement>(null);
  const appStoreApi = useAppStoreApi();
  const disableLineBreaks = opts.disableLineBreaks ?? false;

  useEffect(() => {
    const appStore = appStoreApi.getState();
    const data = appStore.state.indexes.nodes[componentId].data;
    const componentConfig = appStore.getComponentConfig(data.type);

    if (!componentConfig) {
      throw new Error(
        `InlineTextField Error: No config defined for ${data.type}`
      );
    }

    if (ref.current) {
      if (value !== ref.current.innerText) {
        ref.current.replaceChildren(value);
      }

      const cleanupPortal = registerOverlayPortal(ref.current);

      const handleInput = async (e: any) => {
        const appStore = appStoreApi.getState();
        const node = appStore.state.indexes.nodes[componentId];

        let value = e.target.innerText;

        if (disableLineBreaks) {
          value = value.replaceAll(/\n/gm, "");
        }

        const newProps = setDeep(node.data.props, propPath, value);

        const resolvedData = await appStore.resolveComponentData(
          { ...node.data, props: newProps },
          "replace"
        );

        // Extract non-slot props for doc update
        const { id: _id, ...propsToUpdate } = resolvedData.node.props;
        const componentConfig =
          appStore.config.components[node.data.type];
        const fields = componentConfig?.fields ?? {};
        const nonSlotProps: Record<string, any> = {};
        for (const [k, v] of Object.entries(propsToUpdate)) {
          if (!(fields[k] && fields[k].type === "slot")) {
            nonSlotProps[k] = v;
          }
        }

        appStore.pageDocument.updateProps(componentId, nonSlotProps);
        commitDocToStore(appStoreApi, {
          onAction: {
            type: "replace",
            data: resolvedData.node,
            destinationIndex: 0,
            destinationZone: "",
          },
        });
      };

      ref.current.addEventListener("input", handleInput);

      return () => {
        ref.current?.removeEventListener("input", handleInput);

        cleanupPortal?.();
      };
    }
  }, [appStoreApi, ref.current, value, disableLineBreaks]);

  // We disable contentEditable when not hovering or already focused,
  // otherwise Safari focuses the element during drag. Related:
  // https://bugs.webkit.org/show_bug.cgi?id=112854
  const [isHovering, setIsHovering] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  return (
    <span
      className={getClassName()}
      ref={ref}
      contentEditable={isHovering || isFocused ? "plaintext-only" : "false"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClickCapture={(e) => {
        e.preventDefault();
        e.stopPropagation();

        appStoreApi.getState().setUi({ itemSelector: { id: componentId } });
      }}
      onKeyDown={(e) => {
        e.stopPropagation();

        if ((disableLineBreaks && e.key === "Enter") || isReadOnly) {
          e.preventDefault();
        }
      }}
      onKeyUp={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onMouseOverCapture={() => setIsHovering(true)}
      onMouseOutCapture={() => setIsHovering(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
    />
  );
};

export const InlineTextField = memo(InlineTextFieldInternal);
