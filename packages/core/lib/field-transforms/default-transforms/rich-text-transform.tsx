"use client";
import { EditorFallback } from "../../../components/RichTextEditor/components/EditorFallback";
import { RichTextRenderFallback } from "../../../components/RichTextEditor/components/RenderFallback";
import { FieldTransforms } from "../../../types/API/FieldTransforms";
import { useAppStoreApi, commitDocToStore } from "../../../store";
import { setDeep } from "../../../lib/data/set-deep";
import { registerOverlayPortal } from "../../../lib/overlay-portal";
import {
  useEffect,
  useRef,
  useCallback,
  memo,
  MouseEvent,
  lazy,
  Suspense,
} from "react";
import type { Editor as TipTapEditor, JSONContent } from "@tiptap/react";
import { RichtextField, UiState } from "../../../types";

const Editor = lazy(() =>
  import("../../../components/RichTextEditor/components/Editor").then((m) => ({
    default: m.Editor,
  }))
);

const RichTextRender = lazy(() =>
  import("../../../components/RichTextEditor/components/Render").then((m) => ({
    default: m.RichTextRender,
  }))
);

const InlineEditorWrapper = memo(
  ({
    value,
    componentId,
    propPath,
    field,
    id,
  }: {
    value: string;
    componentId: string;
    propPath: string;
    field: RichtextField;
    id: string;
  }) => {
    const portalRef = useRef<HTMLDivElement>(null);
    const appStoreApi = useAppStoreApi();

    const onClickHandler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const onClickCaptureHandler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      appStoreApi.getState().setUi({ itemSelector: { id: componentId } });
    };

    // Register portal once
    useEffect(() => {
      if (!portalRef.current) return;
      const cleanup = registerOverlayPortal(portalRef.current, {
        disableDragOnFocus: true,
      });
      return () => cleanup?.();
    }, [portalRef.current]);

    const handleChange = useCallback(
      async (content: string | JSONContent, ui?: Partial<UiState>) => {
        const appStore = appStoreApi.getState();
        const doc = appStore.pageDocument;
        const block = doc.getBlock(componentId);
        if (!block) return;

        const currentProps = { ...block.props, id: block.id };
        const newProps = setDeep(currentProps, propPath, content);

        const resolvedData = await appStore.resolveComponentData(
          { type: block.type, props: newProps },
          "replace"
        );

        // Extract non-slot props for doc update
        const { id: _id, ...propsToUpdate } = resolvedData.node.props;
        const componentConfig =
          appStore.config.components[block.type];
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
          ui,
        });
      },
      [appStoreApi, componentId, propPath]
    );

    const handleFocus = useCallback(
      (editor: TipTapEditor) => {
        appStoreApi.setState({
          currentRichText: {
            inlineComponentId: componentId,
            inline: true,
            field,
            editor,
            id,
          },
        });
      },
      [field, componentId]
    );

    if (!field.contentEditable)
      return (
        <Suspense fallback={<RichTextRenderFallback content={value} />}>
          <RichTextRender content={value} field={field} />
        </Suspense>
      );

    const editorProps = {
      content: value,
      onChange: handleChange,
      field: field,
      inline: true,
      onFocus: handleFocus,
      id: id,
      name: propPath,
    };

    return (
      <div
        ref={portalRef}
        onClick={onClickHandler}
        onClickCapture={onClickCaptureHandler}
      >
        <Suspense fallback={<EditorFallback {...editorProps} />}>
          <Editor {...editorProps} />
        </Suspense>
      </div>
    );
  }
);

InlineEditorWrapper.displayName = "InlineEditorWrapper";

export const getRichTextTransform = (): FieldTransforms => ({
  richtext: ({ value, componentId, field, propPath, isReadOnly }) => {
    const { contentEditable = true, tiptap } = field;
    if (contentEditable === false || isReadOnly) {
      return <RichTextRender content={value} field={field} />;
    }

    const id = `${componentId}_${field.type}_${propPath}`;

    return (
      <InlineEditorWrapper
        key={id}
        value={value}
        componentId={componentId}
        propPath={propPath}
        field={field}
        id={id}
      />
    );
  },
});
