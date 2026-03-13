import * as Y from "yjs";
import { Config, Data } from "../types";
import { PageDocument } from "./PageDocument";

const SYNC_ORIGIN = "local";

/**
 * Synchronize a PageDocument's Y.Doc to match the given Puck Data snapshot.
 * Used after the legacy reducer produces new state — keeps the Y.Doc
 * in sync as a mirror of the authoritative reducer output.
 *
 * Uses local origin so the UndoManager tracks these syncs for undo/redo.
 */
export function syncDocFromState(
  doc: PageDocument,
  data: Data,
  config: Config
): void {
  doc.ydoc.transact(() => {
    // Clear all blocks
    doc.blocks.clear();
    while (doc.rootBlocks.length > 0) {
      doc.rootBlocks.delete(0, doc.rootBlocks.length);
    }
    // Clear root slots
    for (const key of Array.from(doc.rootSlots.keys())) {
      doc.rootSlots.delete(key);
    }
    // Clear root props
    const rootKeys = Array.from(doc.rootProps.keys());
    for (const k of rootKeys) {
      doc.rootProps.delete(k);
    }

    // Re-import from data
    const tempDoc = PageDocument.fromPuckData(data, config);

    // Copy blocks
    for (const [id, blockMap] of tempDoc.blocks.entries()) {
      const cloned = doc._propsToYMap(blockMap.toJSON());
      doc.blocks.set(id, cloned);
    }

    // Copy rootBlocks
    const rootIds = tempDoc.getRootBlockIds();
    if (rootIds.length > 0) {
      doc.rootBlocks.push(rootIds);
    }

    // Copy root slots
    for (const [slotName, childArr] of tempDoc.rootSlots.entries()) {
      if (childArr instanceof Y.Array) {
        const childIds = childArr.toArray();
        const arr = new Y.Array<string>();
        if (childIds.length > 0) {
          arr.push(childIds);
        }
        doc.rootSlots.set(slotName, arr);
      }
    }

    // Copy root props
    const rootPropsJSON = tempDoc.getRootPropsJSON();
    for (const [k, v] of Object.entries(rootPropsJSON)) {
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        doc.rootProps.set(k, doc._propsToYMap(v));
      } else if (Array.isArray(v)) {
        doc.rootProps.set(k, doc._arrayToYArray(v));
      } else {
        doc.rootProps.set(k, v);
      }
    }

    tempDoc.destroy();
  }, SYNC_ORIGIN);

  doc._rebuildParentIndex();
}
