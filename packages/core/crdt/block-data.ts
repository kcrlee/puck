import { ComponentData, Config } from "../types";
import { PageDocument } from "./PageDocument";

/** Build a ComponentData from a Y.Doc block. */
export function blockToComponentData(
  doc: PageDocument,
  id: string
): ComponentData | null {
  const block = doc.getBlock(id);
  if (!block) return null;
  return {
    type: block.type,
    props: { ...block.props, id: block.id },
    ...(block.readOnly ? { readOnly: block.readOnly } : {}),
  } as ComponentData;
}

/** Build a full ComponentData with nested slot content from Y.Doc (for resolveData parent). */
export function blockToFullComponentData(
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
