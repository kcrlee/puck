import * as Y from "yjs";
import { Config, ComponentData, Content, Data } from "../types";
import { generateId } from "../lib/generate-id";
import {
  BlockLocation,
  BlockTarget,
  ParentIndex,
  SerializedBlock,
  SerializedPage,
} from "./types";

const LOCAL_ORIGIN = "local";
const INIT_ORIGIN = "init";

/**
 * PageDocument wraps a Y.Doc and provides a typed API for Puck page editing.
 *
 * Y.Doc structure:
 *   - blocks: Y.Map<Y.Map>       — flat store of all blocks by ID
 *   - rootBlocks: Y.Array<string> — ordered IDs of top-level content
 *   - root: Y.Map                 — root/page-level props
 *   - meta: Y.Map                 — arbitrary metadata
 *
 * Each block Y.Map has keys: "id", "type", "props" (Y.Map), "slots" (Y.Map of Y.Array<string>), "readOnly" (optional Y.Map).
 */
export class PageDocument {
  readonly ydoc: Y.Doc;
  readonly undoManager: Y.UndoManager;

  private _parentIndex: ParentIndex = new Map();
  private _observers: Set<() => void> = new Set();
  private _config: Config;

  constructor(ydoc?: Y.Doc, config?: Config) {
    this.ydoc = ydoc ?? new Y.Doc();
    this._config = config ?? { components: {} };

    // Initialize shared types (idempotent — getMap/getArray create if absent)
    this.blocks;
    this.rootBlocks;
    this.rootSlots;
    this.rootProps;
    this.meta;

    this.undoManager = new Y.UndoManager(
      [this.blocks, this.rootBlocks, this.rootSlots, this.rootProps],
      {
        trackedOrigins: new Set([LOCAL_ORIGIN]),
        captureTimeout: 500,
      }
    );

    this._rebuildParentIndex();
    this._observeSlots();
  }

  // ── Shared type accessors ──────────────────────────────────────────

  get blocks(): Y.Map<Y.Map<any>> {
    return this.ydoc.getMap("blocks");
  }

  get rootBlocks(): Y.Array<string> {
    return this.ydoc.getArray("rootBlocks");
  }

  /**
   * Root slot children. Each key is a slot name, each value is a Y.Array<string>
   * of block IDs. Used for root-level slot fields (e.g., root:slot), NOT for
   * root:default-zone content (which uses rootBlocks).
   */
  get rootSlots(): Y.Map<Y.Array<string>> {
    return this.ydoc.getMap("rootSlots");
  }

  get rootProps(): Y.Map<any> {
    return this.ydoc.getMap("root");
  }

  get meta(): Y.Map<any> {
    return this.ydoc.getMap("meta");
  }

  get config(): Config {
    return this._config;
  }

  set config(c: Config) {
    this._config = c;
  }

  // ── Read methods ───────────────────────────────────────────────────

  getBlock(id: string): SerializedBlock | null {
    const blockMap = this.blocks.get(id);
    if (!blockMap) return null;

    return {
      id: blockMap.get("id"),
      type: blockMap.get("type"),
      props: this._yMapToJSON(blockMap.get("props")),
      slots: this._slotsToJSON(blockMap.get("slots")),
      ...(blockMap.get("readOnly")
        ? { readOnly: this._yMapToJSON(blockMap.get("readOnly")) }
        : {}),
    };
  }

  getBlockType(id: string): string | null {
    return this.blocks.get(id)?.get("type") ?? null;
  }

  getBlockProps(id: string): Record<string, any> | null {
    const blockMap = this.blocks.get(id);
    if (!blockMap) return null;
    return this._yMapToJSON(blockMap.get("props"));
  }

  getSlotChildren(blockId: string, slotName: string): string[] {
    // Root slots are stored in rootSlots, not in blocks
    if (blockId === "root") {
      const arr = this.rootSlots.get(slotName);
      return arr ? arr.toArray() : [];
    }

    const blockMap = this.blocks.get(blockId);
    if (!blockMap) return [];
    const slots: Y.Map<Y.Array<string>> | undefined = blockMap.get("slots");
    if (!slots) return [];
    const arr = slots.get(slotName);
    return arr ? arr.toArray() : [];
  }

  getRootBlockIds(): string[] {
    return this.rootBlocks.toArray();
  }

  getRootProp(key: string): any {
    return this.rootProps.get(key);
  }

  getRootPropsJSON(): Record<string, any> {
    return this._yMapToJSON(this.rootProps);
  }

  getLocation(id: string): BlockLocation | null {
    return this._parentIndex.get(id) ?? null;
  }

  findParent(id: string): { parentId: string; slotName: string } | null {
    const entry = this._parentIndex.get(id);
    if (!entry || entry.parentId === null) return null;
    return { parentId: entry.parentId, slotName: entry.slotName };
  }

  getAllBlockIds(): string[] {
    return Array.from(this.blocks.keys());
  }

  // ── Write methods ──────────────────────────────────────────────────

  addBlock(
    type: string,
    props: Record<string, any>,
    slotDefs: Record<string, string[]>,
    target: BlockTarget,
    index: number,
    id?: string,
    readOnly?: Partial<Record<string, boolean>>
  ): string {
    const blockId = id ?? generateId(type);

    this.ydoc.transact(() => {
      const blockMap = new Y.Map<any>();
      blockMap.set("id", blockId);
      blockMap.set("type", type);
      blockMap.set("props", this._propsToYMap(props));

      const slotsMap = new Y.Map<Y.Array<string>>();
      for (const [slotName, childIds] of Object.entries(slotDefs)) {
        const arr = new Y.Array<string>();
        arr.push(childIds);
        slotsMap.set(slotName, arr);
      }
      blockMap.set("slots", slotsMap);

      if (readOnly) {
        blockMap.set("readOnly", this._propsToYMap(readOnly as Record<string, any>));
      }

      this.blocks.set(blockId, blockMap);

      // Insert into parent slot, rootBlocks, or root slot
      this._insertIdIntoTarget(blockId, target, index);
    }, LOCAL_ORIGIN);

    return blockId;
  }

  removeBlock(id: string): void {
    this.ydoc.transact(() => {
      this._removeBlockAndChildren(id);
    }, LOCAL_ORIGIN);
  }

  moveBlock(id: string, target: BlockTarget, index: number): void {
    this.ydoc.transact(() => {
      // Remove from current location
      this._detachBlock(id);

      // Insert at new location
      this._insertIdIntoTarget(id, target, index);
    }, LOCAL_ORIGIN);
  }

  updateProp(blockId: string, key: string, value: any): void {
    this.ydoc.transact(() => {
      const blockMap = this.blocks.get(blockId);
      if (!blockMap) return;
      const propsMap: Y.Map<any> = blockMap.get("props");
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        propsMap.set(key, this._propsToYMap(value));
      } else if (Array.isArray(value)) {
        propsMap.set(key, this._arrayToYArray(value));
      } else {
        propsMap.set(key, value);
      }
    }, LOCAL_ORIGIN);
  }

  updateRootProp(key: string, value: any): void {
    this.ydoc.transact(() => {
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        this.rootProps.set(key, this._propsToYMap(value));
      } else if (Array.isArray(value)) {
        this.rootProps.set(key, this._arrayToYArray(value));
      } else {
        this.rootProps.set(key, value);
      }
    }, LOCAL_ORIGIN);
  }

  duplicateBlock(id: string, target?: BlockTarget, index?: number): string | null {
    const block = this.getBlock(id);
    if (!block) return null;

    let newId: string = "";

    this.ydoc.transact(() => {
      newId = this._deepCloneBlock(id, target, index);
    }, LOCAL_ORIGIN);

    return newId || null;
  }

  /**
   * Ensure a slot Y.Array exists on a block (no-op if already present).
   */
  ensureSlot(blockId: string, slotName: string): void {
    this.ydoc.transact(() => {
      const blockMap = this.blocks.get(blockId);
      if (!blockMap) return;
      const slots: Y.Map<Y.Array<string>> = blockMap.get("slots");
      if (!slots.has(slotName)) {
        slots.set(slotName, new Y.Array<string>());
      }
    }, LOCAL_ORIGIN);
  }

  // ── Undo / Redo ────────────────────────────────────────────────────

  undo(): void {
    this.undoManager.undo();
  }

  redo(): void {
    this.undoManager.redo();
  }

  canUndo(): boolean {
    return this.undoManager.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.undoManager.redoStack.length > 0;
  }

  // ── Observation ────────────────────────────────────────────────────

  subscribe(fn: () => void): () => void {
    this._observers.add(fn);
    return () => {
      this._observers.delete(fn);
    };
  }

  private _notifyObservers(): void {
    for (const fn of this._observers) {
      fn();
    }
  }

  // ── Conversion: Puck Data <-> Y.Doc ────────────────────────────────

  /**
   * Build a PageDocument from existing Puck Data.
   */
  static fromPuckData(data: Data, config: Config, ydoc?: Y.Doc): PageDocument {
    const doc = new PageDocument(ydoc, config);

    doc.ydoc.transact(() => {
      // Clear existing data
      doc.blocks.clear();
      while (doc.rootBlocks.length > 0) {
        doc.rootBlocks.delete(0, doc.rootBlocks.length);
      }

      // Root props — separate slot fields from regular props
      const rootData = data.root;
      const rootPropsSrc =
        rootData && "props" in rootData && rootData.props
          ? rootData.props
          : (rootData as any) ?? {};

      const rootFields = config.root?.fields ?? {};

      // Clear root slots
      for (const key of Array.from(doc.rootSlots.keys())) {
        doc.rootSlots.delete(key);
      }
      // Clear root props
      for (const key of Array.from(doc.rootProps.keys())) {
        doc.rootProps.delete(key);
      }

      // Process content blocks recursively — defined before root props
      // processing since root slot fields need to call this.
      const addBlockFromComponentData = (
        item: ComponentData,
        config: Config
      ): string => {
        const blockId = item.props.id ?? generateId(item.type);
        const componentConfig = config.components[item.type];
        const fields = componentConfig?.fields ?? {};

        // Separate slot fields from regular props
        const props: Record<string, any> = {};
        const slotDefs: Record<string, string[]> = {};

        for (const [key, val] of Object.entries(item.props)) {
          if (key === "id") continue;

          const field = fields[key];
          if (field && field.type === "slot") {
            // This is a slot — val is Content (array of ComponentData)
            const children = (val as Content) ?? [];
            const childIds: string[] = [];
            for (const child of children) {
              const childId = addBlockFromComponentData(child, config);
              childIds.push(childId);
            }
            slotDefs[key] = childIds;
          } else {
            props[key] = val;
          }
        }

        // Ensure all slot fields have entries (even if empty)
        for (const [fieldName, fieldDef] of Object.entries(fields)) {
          if (fieldDef.type === "slot" && !(fieldName in slotDefs)) {
            slotDefs[fieldName] = [];
          }
        }

        const blockMap = new Y.Map<any>();
        blockMap.set("id", blockId);
        blockMap.set("type", item.type);
        blockMap.set("props", doc._propsToYMap(props));

        const slotsMap = new Y.Map<Y.Array<string>>();
        for (const [slotName, childIds] of Object.entries(slotDefs)) {
          const arr = new Y.Array<string>();
          if (childIds.length > 0) {
            arr.push(childIds);
          }
          slotsMap.set(slotName, arr);
        }
        blockMap.set("slots", slotsMap);

        if (item.readOnly) {
          blockMap.set("readOnly", doc._propsToYMap(item.readOnly as Record<string, any>));
        }

        doc.blocks.set(blockId, blockMap);
        return blockId;
      };

      // Root props — process slot fields into rootSlots, rest into rootProps
      const { id: _id, ...rootPropsClean } = rootPropsSrc;
      for (const [k, v] of Object.entries(rootPropsClean)) {
        const field = rootFields[k];
        if (field && field.type === "slot") {
          // Root slot field — process children into flat block store
          const children = (v as Content) ?? [];
          const childIds: string[] = [];
          for (const child of children) {
            const childId = addBlockFromComponentData(child, config);
            childIds.push(childId);
          }
          const arr = new Y.Array<string>();
          if (childIds.length > 0) {
            arr.push(childIds);
          }
          doc.rootSlots.set(k, arr);
        } else if (
          v !== null &&
          typeof v === "object" &&
          !Array.isArray(v)
        ) {
          doc.rootProps.set(k, doc._propsToYMap(v));
        } else if (Array.isArray(v)) {
          doc.rootProps.set(k, doc._arrayToYArray(v));
        } else {
          doc.rootProps.set(k, v);
        }
      }

      if (rootData && rootData.readOnly) {
        doc.rootProps.set("__readOnly", doc._propsToYMap(rootData.readOnly as Record<string, any>));
      }

      // Root content
      const rootIds: string[] = [];
      for (const item of data.content ?? []) {
        rootIds.push(addBlockFromComponentData(item, config));
      }
      if (rootIds.length > 0) {
        doc.rootBlocks.push(rootIds);
      }

      // Legacy zones (data.zones) — blocks stored in DropZones
      if (data.zones) {
        for (const [zoneCompound, content] of Object.entries(data.zones)) {
          const [parentId, slotName] = zoneCompound.split(":");
          const childIds: string[] = [];
          for (const item of content ?? []) {
            childIds.push(addBlockFromComponentData(item, config));
          }

          // Attach children to parent block's slot.
          // If the parent doesn't exist yet (orphaned DropZone zone — parent
          // rendered by a component that isn't in the content tree), create a
          // stub block to preserve the zone relationship.
          let parentMap = doc.blocks.get(parentId);
          if (!parentMap && parentId !== "root") {
            parentMap = new Y.Map<any>();
            parentMap.set("id", parentId);
            parentMap.set("type", "__dropzone_stub");
            parentMap.set("props", new Y.Map());
            parentMap.set("slots", new Y.Map<Y.Array<string>>());
            doc.blocks.set(parentId, parentMap);
          }
          if (parentMap) {
            const slots: Y.Map<Y.Array<string>> = parentMap.get("slots");
            let arr = slots.get(slotName);
            if (!arr) {
              arr = new Y.Array<string>();
              slots.set(slotName, arr);
            }
            if (childIds.length > 0) {
              arr.push(childIds);
            }
          }
        }
      }
    }, INIT_ORIGIN);

    // Clear undo stack so the initial load is not undoable
    doc.undoManager.clear();
    doc._rebuildParentIndex();

    return doc;
  }

  /**
   * Materialize Y.Doc back to Puck's Data shape.
   */
  toPuckData(): Data {
    const rootBlockIds = this.getRootBlockIds();
    const zones: Record<string, Content> = {};

    const materializeBlock = (id: string): ComponentData | null => {
      const blockMap = this.blocks.get(id);
      if (!blockMap) return null;

      const type = blockMap.get("type") as string;
      const propsMap: Y.Map<any> = blockMap.get("props");
      const slotsMap: Y.Map<Y.Array<string>> = blockMap.get("slots");
      const readOnlyMap: Y.Map<any> | undefined = blockMap.get("readOnly");

      const componentConfig = this._config.components[type];
      const fields = componentConfig?.fields ?? {};

      const props: Record<string, any> = {
        ...this._yMapToJSON(propsMap),
        id,
      };

      // Materialize slots — slot fields go on props, DropZone content goes in zones
      if (slotsMap) {
        for (const [slotName, childArr] of slotsMap.entries()) {
          const childIds = childArr instanceof Y.Array ? childArr.toArray() : [];
          const children: ComponentData[] = [];
          for (const childId of childIds) {
            const child = materializeBlock(childId);
            if (child) children.push(child);
          }

          const field = fields[slotName];
          if (field && field.type === "slot") {
            // Slot field — content goes on props
            props[slotName] = children;
          } else {
            // DropZone — content goes in data.zones
            zones[`${id}:${slotName}`] = children;
          }
        }
      }

      // Ensure all slot fields have empty arrays even if not in Y.Doc
      for (const [fieldName, fieldDef] of Object.entries(fields)) {
        if (fieldDef.type === "slot" && !(fieldName in props)) {
          props[fieldName] = [];
        }
      }

      const result: ComponentData = { type, props } as ComponentData;

      if (readOnlyMap) {
        result.readOnly = this._yMapToJSON(readOnlyMap);
      }

      return result;
    };

    // Root content
    const content: Content = [];
    for (const id of rootBlockIds) {
      const block = materializeBlock(id);
      if (block) content.push(block);
    }

    // Root props — reconstruct slot content from rootSlots
    const rootPropsRaw = this.getRootPropsJSON();
    const { __readOnly, ...rootPropsClean } = rootPropsRaw;
    const rootFields = this._config.root?.fields ?? {};

    // Add root slot children as materialized content on root props
    for (const [slotName, childArr] of this.rootSlots.entries()) {
      if (!(childArr instanceof Y.Array)) continue;
      const childIds = childArr.toArray();
      const children: ComponentData[] = [];
      for (const childId of childIds) {
        const child = materializeBlock(childId);
        if (child) children.push(child);
      }
      rootPropsClean[slotName] = children;
    }

    // Ensure all root slot fields have empty arrays
    for (const [fieldName, fieldDef] of Object.entries(rootFields)) {
      if (fieldDef.type === "slot" && !(fieldName in rootPropsClean)) {
        rootPropsClean[fieldName] = [];
      }
    }

    // Materialize DropZone zones from stub blocks (orphaned zone parents)
    // and any block slots that weren't reached through the content tree
    for (const [blockId, blockMap] of this.blocks.entries()) {
      const type = blockMap.get("type") as string;
      const slotsMap: Y.Map<Y.Array<string>> | undefined = blockMap.get("slots");
      if (!slotsMap) continue;

      if (type === "__dropzone_stub") {
        // Stub block — all slots become zones
        for (const [slotName, childArr] of slotsMap.entries()) {
          if (!(childArr instanceof Y.Array)) continue;
          const zoneCompound = `${blockId}:${slotName}`;
          if (zoneCompound in zones) continue; // Already processed
          const childIds = childArr.toArray();
          const children: ComponentData[] = [];
          for (const childId of childIds) {
            const child = materializeBlock(childId);
            if (child) children.push(child);
          }
          zones[zoneCompound] = children;
        }
      }
    }

    const root: any = { props: rootPropsClean };
    if (__readOnly) {
      root.readOnly = __readOnly;
    }

    return {
      root,
      content,
      zones,
    };
  }

  // ── Serialization ──────────────────────────────────────────────────

  toJSON(): SerializedPage {
    const blocks: Record<string, SerializedBlock> = {};

    for (const [id, blockMap] of this.blocks.entries()) {
      blocks[id] = {
        id: blockMap.get("id"),
        type: blockMap.get("type"),
        props: this._yMapToJSON(blockMap.get("props")),
        slots: this._slotsToJSON(blockMap.get("slots")),
        ...(blockMap.get("readOnly")
          ? { readOnly: this._yMapToJSON(blockMap.get("readOnly")) }
          : {}),
      };
    }

    const rootPropsRaw = this.getRootPropsJSON();
    const { __readOnly, ...rootPropsClean } = rootPropsRaw;

    return {
      root: {
        props: rootPropsClean,
        ...__readOnly ? { readOnly: __readOnly } : {},
      },
      blocks,
      rootBlockIds: this.getRootBlockIds(),
    };
  }

  toBinary(): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc);
  }

  static fromBinary(update: Uint8Array, config?: Config): PageDocument {
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, update);
    return new PageDocument(ydoc, config);
  }

  // ── Destroy ────────────────────────────────────────────────────────

  destroy(): void {
    this.undoManager.destroy();
    this._observers.clear();
    this.ydoc.destroy();
  }

  // ── Private helpers ────────────────────────────────────────────────

  private _removeBlockAndChildren(id: string): void {
    const blockMap = this.blocks.get(id);
    if (!blockMap) return;

    // Recurse into slots to remove children first
    const slotsMap: Y.Map<Y.Array<string>> | undefined = blockMap.get("slots");
    if (slotsMap) {
      for (const [, childArr] of slotsMap.entries()) {
        if (childArr instanceof Y.Array) {
          const childIds = childArr.toArray();
          for (const childId of childIds) {
            this._removeBlockAndChildren(childId);
          }
        }
      }
    }

    // Detach from parent
    this._detachBlock(id);

    // Remove from flat store
    this.blocks.delete(id);
  }

  /**
   * Insert a block ID into a target location (rootBlocks, rootSlots, or block slot).
   */
  private _insertIdIntoTarget(
    blockId: string,
    target: BlockTarget,
    index?: number
  ): void {
    if (target.parentId === null && target.slotName === "default-zone") {
      const idx = Math.min(index ?? this.rootBlocks.length, this.rootBlocks.length);
      this.rootBlocks.insert(idx, [blockId]);
    } else if (target.parentId === null) {
      // Root slot
      let arr = this.rootSlots.get(target.slotName);
      if (!arr) {
        arr = new Y.Array<string>();
        this.rootSlots.set(target.slotName, arr);
      }
      const idx = Math.min(index ?? arr.length, arr.length);
      arr.insert(idx, [blockId]);
    } else {
      const parentMap = this.blocks.get(target.parentId);
      if (parentMap) {
        const slots: Y.Map<Y.Array<string>> = parentMap.get("slots");
        let arr = slots.get(target.slotName);
        if (!arr) {
          arr = new Y.Array<string>();
          slots.set(target.slotName, arr);
        }
        const idx = Math.min(index ?? arr.length, arr.length);
        arr.insert(idx, [blockId]);
      }
    }
  }

  private _detachBlock(id: string): void {
    const entry = this._parentIndex.get(id);
    if (!entry) return;

    if (entry.parentId === null && entry.slotName === "default-zone") {
      // In rootBlocks
      const arr = this.rootBlocks.toArray();
      const idx = arr.indexOf(id);
      if (idx !== -1) {
        this.rootBlocks.delete(idx, 1);
      }
    } else if (entry.parentId === null) {
      // In a root slot
      const arr = this.rootSlots.get(entry.slotName);
      if (arr) {
        const items = arr.toArray();
        const idx = items.indexOf(id);
        if (idx !== -1) {
          arr.delete(idx, 1);
        }
      }
    } else {
      const parentMap = this.blocks.get(entry.parentId);
      if (parentMap) {
        const slots: Y.Map<Y.Array<string>> = parentMap.get("slots");
        const arr = slots?.get(entry.slotName);
        if (arr) {
          const items = arr.toArray();
          const idx = items.indexOf(id);
          if (idx !== -1) {
            arr.delete(idx, 1);
          }
        }
      }
    }
  }

  private _deepCloneBlock(
    sourceId: string,
    target?: BlockTarget,
    insertIndex?: number
  ): string {
    const block = this.getBlock(sourceId);
    if (!block) return "";

    const newId = generateId(block.type);

    // Clone children recursively
    const newSlotDefs: Record<string, string[]> = {};
    for (const [slotName, childIds] of Object.entries(block.slots)) {
      const newChildIds: string[] = [];
      for (const childId of childIds) {
        const clonedChildId = this._deepCloneBlock(childId);
        if (clonedChildId) newChildIds.push(clonedChildId);
      }
      newSlotDefs[slotName] = newChildIds;
    }

    // Create the block Y.Map
    const blockMap = new Y.Map<any>();
    blockMap.set("id", newId);
    blockMap.set("type", block.type);
    blockMap.set("props", this._propsToYMap(block.props));

    const slotsMap = new Y.Map<Y.Array<string>>();
    for (const [slotName, childIds] of Object.entries(newSlotDefs)) {
      const arr = new Y.Array<string>();
      if (childIds.length > 0) {
        arr.push(childIds);
      }
      slotsMap.set(slotName, arr);
    }
    blockMap.set("slots", slotsMap);

    if (block.readOnly) {
      blockMap.set("readOnly", this._propsToYMap(block.readOnly as Record<string, any>));
    }

    this.blocks.set(newId, blockMap);

    // If target specified, insert there. Otherwise insert after source in same parent.
    if (target) {
      this._insertIdIntoTarget(newId, target, insertIndex);
    } else {
      // Insert after source in the same parent
      const sourceEntry = this._parentIndex.get(sourceId);
      if (sourceEntry) {
        this._insertIdIntoTarget(
          newId,
          { parentId: sourceEntry.parentId, slotName: sourceEntry.slotName },
          sourceEntry.index + 1
        );
      }
    }

    return newId;
  }

  // ── Y.js data conversion helpers ───────────────────────────────────

  _propsToYMap(obj: Record<string, any>): Y.Map<any> {
    const ymap = new Y.Map<any>();
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined) continue;

      if (value instanceof Y.AbstractType) {
        ymap.set(key, value);
      } else if (Array.isArray(value)) {
        ymap.set(key, this._arrayToYArray(value));
      } else if (value !== null && typeof value === "object") {
        ymap.set(key, this._propsToYMap(value));
      } else {
        ymap.set(key, value);
      }
    }
    return ymap;
  }

  _arrayToYArray(arr: any[]): Y.Array<any> {
    const yarray = new Y.Array<any>();
    const items = arr.map((item) => {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        return this._propsToYMap(item);
      } else if (Array.isArray(item)) {
        return this._arrayToYArray(item);
      }
      return item;
    });
    if (items.length > 0) {
      yarray.push(items);
    }
    return yarray;
  }

  _yMapToJSON(ymap: Y.Map<any> | undefined): Record<string, any> {
    if (!ymap || !(ymap instanceof Y.Map)) return {};
    const result: Record<string, any> = {};
    for (const [key, value] of ymap.entries()) {
      result[key] = this._yValueToJS(value);
    }
    return result;
  }

  private _yValueToJS(value: any): any {
    if (value instanceof Y.Map) {
      return this._yMapToJSON(value);
    } else if (value instanceof Y.Array) {
      return value.toArray().map((item: any) => this._yValueToJS(item));
    }
    return value;
  }

  private _slotsToJSON(
    slotsMap: Y.Map<Y.Array<string>> | undefined
  ): Record<string, string[]> {
    if (!slotsMap || !(slotsMap instanceof Y.Map)) return {};
    const result: Record<string, string[]> = {};
    for (const [key, value] of slotsMap.entries()) {
      if (value instanceof Y.Array) {
        result[key] = value.toArray();
      } else {
        result[key] = [];
      }
    }
    return result;
  }

  // ── Parent Index ───────────────────────────────────────────────────

  get parentIndex(): ParentIndex {
    return this._parentIndex;
  }

  _rebuildParentIndex(): void {
    const index: ParentIndex = new Map();

    // Root blocks (root:default-zone)
    const rootIds = this.rootBlocks.toArray();
    for (let i = 0; i < rootIds.length; i++) {
      index.set(rootIds[i], {
        parentId: null,
        slotName: "default-zone",
        index: i,
      });
    }

    // Root slot children (root:slotName)
    for (const [slotName, childArr] of this.rootSlots.entries()) {
      if (!(childArr instanceof Y.Array)) continue;
      const childIds = childArr.toArray();
      for (let i = 0; i < childIds.length; i++) {
        index.set(childIds[i], {
          parentId: null,
          slotName,
          index: i,
        });
      }
    }

    // All blocks' slots
    for (const [blockId, blockMap] of this.blocks.entries()) {
      const slotsMap: Y.Map<Y.Array<string>> | undefined =
        blockMap.get("slots");
      if (!slotsMap) continue;

      for (const [slotName, childArr] of slotsMap.entries()) {
        if (!(childArr instanceof Y.Array)) continue;
        const childIds = childArr.toArray();
        for (let i = 0; i < childIds.length; i++) {
          index.set(childIds[i], {
            parentId: blockId,
            slotName,
            index: i,
          });
        }
      }
    }

    this._parentIndex = index;
  }

  private _observeSlots(): void {
    // Observe rootBlocks changes
    this.rootBlocks.observeDeep(() => {
      this._rebuildParentIndex();
      this._notifyObservers();
    });

    // Observe root slot children
    this.rootSlots.observeDeep(() => {
      this._rebuildParentIndex();
      this._notifyObservers();
    });

    // Observe blocks map for additions/deletions and deep changes in slots
    this.blocks.observeDeep(() => {
      this._rebuildParentIndex();
      this._notifyObservers();
    });

    // Observe root props changes
    this.rootProps.observeDeep(() => {
      this._notifyObservers();
    });
  }
}
