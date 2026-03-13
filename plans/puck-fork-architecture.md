# Puck Fork Architecture: Native Yjs + Convex Integration

## Overview

This document describes the strategy for forking Puck and replacing its internal state management with a Yjs CRDT-backed data layer, using Convex as the sync transport. The goal is to keep Puck's mature editor UI (drag and drop, component panel, field editors, overlays, preview, keyboard shortcuts) while eliminating the opaque snapshot problem that requires diffing and bridging for real-time collaboration.

The core change: instead of Puck producing immutable `Data` snapshots on every action and emitting them via `onChange`, every user action mutates a `Y.Doc` directly. There is no diff, no bridge, no round-trip serialization. The Y.Doc *is* the document.

## Architecture Comparison

### Before (Puck + Diff Bridge)

```
User action → Puck reducer → new Data snapshot → onChange
  → diffPuckData(prev, next) → PageOperation[]
  → applyToYDoc(ops) → Yjs delta → Convex mutation
  → Convex subscription → ydocToPuckData(ydoc) → Puck.setData()
```

### After (Forked Puck)

```
User action → Y.Doc mutation (direct)
  → Yjs delta → Convex mutation
  → Convex subscription → Y.Doc merge → reactive re-render
```

The entire diff layer, operation types, LIS algorithm, and serialization round-trip are eliminated.

## What Changes vs What Stays

### Changes (state layer — concentrated in ~10-15 files)

| Area | Current Puck | Fork |
|------|-------------|------|
| Data model | Immutable `Data` object (plain JS) | `Y.Doc` with structured shared types |
| Reducer | Produces new snapshot per action | Dispatches Y.Doc mutations |
| State access | `usePuck()` reads from `Data` | `usePuck()` reads from Y.Doc observations |
| onChange | Emits full `Data` on every change | Eliminated — Yjs handles sync |
| Undo/redo | Snapshot history stack | `Y.UndoManager` |
| Block identity | `props.id` in nested arrays | Block ID as key in `Y.Map('blocks')` |
| Rich text | External (if any) | `Y.Text` as a native prop type |

### Stays (editor UI — untouched)

- Drag and drop system (DraggableComponent, DropZone)
- Component panel and category browser
- Field editors (all field types)
- iframe preview
- Overlay system (selection, hover, component overlays)
- Keyboard shortcuts
- Plugin API / overrides API surface
- Resize handles
- Viewport switching
- CSS / theming

## Y.Doc Structure

The document model uses Yjs shared types that mirror Puck's semantic structure while enabling granular conflict resolution.

```
Y.Doc
├── Y.Map('meta')
│   ├── 'title': string
│   ├── 'slug': string
│   └── 'status': 'draft' | 'published'
│
├── Y.Map('root')
│   └── Y.Map('props')                ← page-level settings (theme, SEO, etc.)
│
├── Y.Map('blocks')                    ← flat block store: blockId → Y.Map
│   ├── Y.Map('block-abc')
│   │   ├── 'type': string
│   │   ├── Y.Map('props')
│   │   │   ├── 'heading': Y.Text     ← collaborative rich text, natively
│   │   │   ├── 'color': string
│   │   │   ├── 'padding': Y.Map      ← nested structured props
│   │   │   └── ...
│   │   └── Y.Map('slots')
│   │       ├── Y.Array('content')     ← ordered list of child block IDs
│   │       └── Y.Array('sidebar')
│   │
│   └── Y.Map('block-def')
│       └── ...
│
└── Y.Array('rootBlocks')              ← top-level block ordering (IDs only)
```

### Why flat block storage + ID references

**Moves are cheap and conflict-free.** Moving a block between slots only touches the source and target `Y.Array`s (delete ID from one, insert into other). The block's own data is untouched. In Puck's current model, a move duplicates the entire block data structure.

**Prop edits are granular.** Each prop is an independent key in a `Y.Map`. Two users changing different props on the same block merge cleanly — no diffing needed, no last-writer-wins at the block level.

**Rich text is native.** `Y.Text` props get character-level collaborative editing for free. No separate editor sync, no ProseMirror bridge.

**Re-renders are surgical.** A React component observing a single block's `Y.Map` only re-renders when that specific block changes, not when any block on the page changes.

## PageDocument API

The `PageDocument` class wraps the Y.Doc and provides the interface that the editor and components interact with. All write methods produce Yjs ops directly inside a `transact()` call.

```ts
class PageDocument {
  readonly ydoc: Y.Doc;
  readonly blocks: Y.Map<Y.Map<any>>;
  readonly rootBlocks: Y.Array<string>;
  readonly root: Y.Map<any>;
  readonly undoManager: Y.UndoManager;

  constructor(ydoc: Y.Doc) {
    this.ydoc = ydoc;
    this.blocks = ydoc.getMap('blocks');
    this.rootBlocks = ydoc.getArray('rootBlocks');
    this.root = ydoc.getMap('root');
    this.undoManager = new Y.UndoManager(
      [this.blocks, this.rootBlocks, this.root],
      { trackedOrigins: new Set(['local']) }
    );
  }

  // ── Reading ──────────────────────────────────────────────

  getBlock(id: string): Y.Map<any> | undefined {
    return this.blocks.get(id) as Y.Map<any> | undefined;
  }

  getBlockType(id: string): string {
    return this.getBlock(id)?.get('type') as string;
  }

  getBlockProps(id: string): Y.Map<any> {
    return this.getBlock(id)?.get('props') as Y.Map<any>;
  }

  getSlotChildren(blockId: string, slotName: string): string[] {
    const block = this.getBlock(blockId);
    const slots = block?.get('slots') as Y.Map<Y.Array<string>>;
    return slots?.get(slotName)?.toArray() ?? [];
  }

  getRootBlockIds(): string[] {
    return this.rootBlocks.toArray();
  }

  getText(blockId: string, propName: string): Y.Text {
    const props = this.getBlockProps(blockId);
    return props.get(propName) as Y.Text;
  }

  // ── Finding ──────────────────────────────────────────────

  findParent(blockId: string): { parentId: string | null; slotName: string; index: number } | null {
    // Check root blocks
    const rootIdx = this.rootBlocks.toArray().indexOf(blockId);
    if (rootIdx !== -1) {
      return { parentId: null, slotName: 'root', index: rootIdx };
    }

    // Search all blocks' slots
    for (const [id, block] of this.blocks.entries()) {
      const slots = (block as Y.Map<any>).get('slots') as Y.Map<Y.Array<string>>;
      if (!slots) continue;
      for (const [slotName, slotArray] of slots.entries()) {
        const arr = (slotArray as Y.Array<string>).toArray();
        const idx = arr.indexOf(blockId);
        if (idx !== -1) {
          return { parentId: id, slotName, index: idx };
        }
      }
    }

    return null;
  }

  // ── Writing ──────────────────────────────────────────────

  addBlock(
    type: string,
    props: Record<string, any>,
    slots: Record<string, string[]>,
    target: { parentId: string | null; slotName: string },
    index: number
  ): string {
    const id = crypto.randomUUID();

    this.ydoc.transact(() => {
      // Create block
      const yBlock = new Y.Map();
      yBlock.set('type', type);
      yBlock.set('props', this._propsToYMap(props));

      const ySlots = new Y.Map();
      for (const [slotName, children] of Object.entries(slots)) {
        const yArr = new Y.Array<string>();
        yArr.push(children);
        ySlots.set(slotName, yArr);
      }
      yBlock.set('slots', ySlots);

      this.blocks.set(id, yBlock);

      // Insert ID into target slot
      if (target.parentId === null) {
        this.rootBlocks.insert(index, [id]);
      } else {
        const parentSlots = this.getBlock(target.parentId)?.get('slots') as Y.Map<Y.Array<string>>;
        const slot = parentSlots.get(target.slotName) as Y.Array<string>;
        slot.insert(index, [id]);
      }
    }, 'local');

    return id;
  }

  removeBlock(id: string): void {
    this.ydoc.transact(() => {
      // Remove from parent slot
      const location = this.findParent(id);
      if (location) {
        if (location.parentId === null) {
          this.rootBlocks.delete(location.index, 1);
        } else {
          const parentSlots = this.getBlock(location.parentId)?.get('slots') as Y.Map<Y.Array<string>>;
          const slot = parentSlots.get(location.slotName) as Y.Array<string>;
          slot.delete(location.index, 1);
        }
      }

      // Recursively remove child blocks
      this._removeBlockAndChildren(id);
    }, 'local');
  }

  moveBlock(
    id: string,
    target: { parentId: string | null; slotName: string },
    index: number
  ): void {
    this.ydoc.transact(() => {
      // Remove from current location
      const location = this.findParent(id);
      if (location) {
        if (location.parentId === null) {
          this.rootBlocks.delete(location.index, 1);
        } else {
          const parentSlots = this.getBlock(location.parentId)?.get('slots') as Y.Map<Y.Array<string>>;
          const slot = parentSlots.get(location.slotName) as Y.Array<string>;
          slot.delete(location.index, 1);
        }
      }

      // Insert into new location
      if (target.parentId === null) {
        const adjustedIndex = Math.min(index, this.rootBlocks.length);
        this.rootBlocks.insert(adjustedIndex, [id]);
      } else {
        const parentSlots = this.getBlock(target.parentId)?.get('slots') as Y.Map<Y.Array<string>>;
        const slot = parentSlots.get(target.slotName) as Y.Array<string>;
        const adjustedIndex = Math.min(index, slot.length);
        slot.insert(adjustedIndex, [id]);
      }
    }, 'local');
  }

  updateProp(blockId: string, key: string, value: any): void {
    this.ydoc.transact(() => {
      const props = this.getBlockProps(blockId);
      if (value instanceof Y.Text || value instanceof Y.Map || value instanceof Y.Array) {
        props.set(key, value);
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        props.set(key, this._propsToYMap(value));
      } else {
        props.set(key, value);
      }
    }, 'local');
  }

  updateRootProp(key: string, value: any): void {
    this.ydoc.transact(() => {
      const rootProps = this.root.get('props') as Y.Map<any>;
      rootProps.set(key, value);
    }, 'local');
  }

  // ── Undo/Redo ────────────────────────────────────────────

  undo(): void { this.undoManager.undo(); }
  redo(): void { this.undoManager.redo(); }
  canUndo(): boolean { return this.undoManager.undoStack.length > 0; }
  canRedo(): boolean { return this.undoManager.redoStack.length > 0; }

  // ── Tree Traversal ───────────────────────────────────────

  walk(callback: (block: Y.Map<any>, parentId: string | null, slotName: string, depth: number) => void): void {
    const walkSlot = (blockIds: string[], parentId: string | null, slotName: string, depth: number) => {
      for (const id of blockIds) {
        const block = this.getBlock(id);
        if (!block) continue;
        callback(block, parentId, slotName, depth);

        const slots = block.get('slots') as Y.Map<Y.Array<string>>;
        if (slots) {
          for (const [childSlotName, childArr] of slots.entries()) {
            walkSlot((childArr as Y.Array<string>).toArray(), id, childSlotName, depth + 1);
          }
        }
      }
    };

    walkSlot(this.getRootBlockIds(), null, 'root', 0);
  }

  // ── Serialization (for storefront) ───────────────────────

  toJSON(): SerializedPage {
    const serializeBlock = (id: string): SerializedBlock => {
      const block = this.getBlock(id)!;
      const props = block.get('props') as Y.Map<any>;
      const slots = block.get('slots') as Y.Map<Y.Array<string>>;

      const serializedSlots: Record<string, SerializedBlock[]> = {};
      if (slots) {
        for (const [slotName, childArr] of slots.entries()) {
          serializedSlots[slotName] = (childArr as Y.Array<string>)
            .toArray()
            .map(serializeBlock);
        }
      }

      return {
        type: block.get('type') as string,
        props: this._yMapToPlain(props),
        slots: serializedSlots,
      };
    };

    return {
      root: this._yMapToPlain(this.root.get('props') as Y.Map<any>),
      blocks: this.getRootBlockIds().map(serializeBlock),
    };
  }

  toBinary(): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc);
  }

  // ── Internal helpers ─────────────────────────────────────

  private _removeBlockAndChildren(id: string): void {
    const block = this.getBlock(id);
    if (!block) return;

    const slots = block.get('slots') as Y.Map<Y.Array<string>>;
    if (slots) {
      for (const [, childArr] of slots.entries()) {
        for (const childId of (childArr as Y.Array<string>).toArray()) {
          this._removeBlockAndChildren(childId);
        }
      }
    }

    this.blocks.delete(id);
  }

  private _propsToYMap(obj: Record<string, any>): Y.Map<any> {
    const yMap = new Y.Map();
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        yMap.set(key, this._propsToYMap(value));
      } else {
        yMap.set(key, value);
      }
    }
    return yMap;
  }

  private _yMapToPlain(yMap: Y.Map<any>): Record<string, any> {
    const obj: Record<string, any> = {};
    yMap.forEach((value: any, key: string) => {
      if (value instanceof Y.Map) {
        obj[key] = this._yMapToPlain(value);
      } else if (value instanceof Y.Text) {
        obj[key] = value.toJSON(); // or value.toDelta() for rich text
      } else if (value instanceof Y.Array) {
        obj[key] = value.toArray();
      } else {
        obj[key] = value;
      }
    });
    return obj;
  }
}
```

### Serialized Types (for storefront rendering)

```ts
interface SerializedPage {
  root: Record<string, any>;
  blocks: SerializedBlock[];
}

interface SerializedBlock {
  type: string;
  props: Record<string, any>;
  slots: Record<string, SerializedBlock[]>;
}
```

## Puck Reducer Transformation

### Current Puck Pattern

Each action clones the entire `Data` object and returns a new snapshot:

```ts
// Simplified from Puck's reducer
case "insert": {
  const newData = structuredClone(state.data);
  const zone = newData.zones[action.destinationZone] ?? newData.content;
  zone.splice(action.destinationIndex, 0, {
    type: action.componentType,
    props: { id: generateId(), ...action.defaultProps },
  });
  return { ...state, data: newData };
}

case "move": {
  const newData = structuredClone(state.data);
  // ... complex zone manipulation to remove from source, insert at destination
  return { ...state, data: newData };
}

case "setProp": {
  const newData = structuredClone(state.data);
  const item = findItemById(newData, action.id);
  item.props[action.key] = action.value;
  return { ...state, data: newData };
}
```

### Forked Pattern

Each action calls a `PageDocument` method that mutates the Y.Doc. No return value needed — Yjs observation triggers re-renders.

```ts
case "insert": {
  doc.addBlock(
    action.componentType,
    { id: crypto.randomUUID(), ...action.defaultProps },
    action.slotDefinitions ?? {},
    {
      parentId: action.destinationParentId ?? null,
      slotName: action.destinationSlotName ?? 'root',
    },
    action.destinationIndex
  );
  break;
}

case "move": {
  doc.moveBlock(
    action.blockId,
    {
      parentId: action.destinationParentId ?? null,
      slotName: action.destinationSlotName ?? 'root',
    },
    action.destinationIndex
  );
  break;
}

case "setProp": {
  doc.updateProp(action.blockId, action.key, action.value);
  break;
}

case "undo": {
  doc.undo();
  break;
}

case "redo": {
  doc.redo();
  break;
}
```

## React Hooks: Reactive Y.Doc Observation

These hooks bridge Y.Doc changes into React's rendering cycle. Each hook subscribes to the minimal Yjs type needed, ensuring surgical re-renders.

```ts
// ── Core Y.Doc observation hooks ──────────────────────────

function useYMap(ymap: Y.Map<any>): Record<string, any> {
  const [state, setState] = useState(() => Object.fromEntries(ymap.entries()));

  useEffect(() => {
    const handler = () => setState(Object.fromEntries(ymap.entries()));
    ymap.observeDeep(handler);
    return () => ymap.unobserveDeep(handler);
  }, [ymap]);

  return state;
}

function useYMapValue<T>(ymap: Y.Map<any>, key: string): T {
  const [value, setValue] = useState<T>(() => ymap.get(key));

  useEffect(() => {
    const handler = (events: Y.YMapEvent<any>) => {
      if (events.keysChanged.has(key)) {
        setValue(ymap.get(key));
      }
    };
    ymap.observe(handler);
    return () => ymap.unobserve(handler);
  }, [ymap, key]);

  return value;
}

function useYArray<T>(yarray: Y.Array<T>): T[] {
  const [state, setState] = useState<T[]>(() => yarray.toArray());

  useEffect(() => {
    const handler = () => setState(yarray.toArray());
    yarray.observe(handler);
    return () => yarray.unobserve(handler);
  }, [yarray]);

  return state;
}

// ── Page document context ─────────────────────────────────

const PageDocumentContext = createContext<PageDocument | null>(null);

function usePageDocument(): PageDocument {
  const doc = useContext(PageDocumentContext);
  if (!doc) throw new Error('usePageDocument must be used within a PageDocumentProvider');
  return doc;
}

// ── Block-level hooks ─────────────────────────────────────

function useBlock(blockId: string) {
  const doc = usePageDocument();
  const yBlock = doc.getBlock(blockId);
  if (!yBlock) return null;

  const type = useYMapValue<string>(yBlock, 'type');
  const props = useYMap(yBlock.get('props') as Y.Map<any>);
  const slotsMap = yBlock.get('slots') as Y.Map<Y.Array<string>>;

  // Observe each slot's child array
  const slots: Record<string, string[]> = {};
  if (slotsMap) {
    for (const [slotName, slotArr] of slotsMap.entries()) {
      slots[slotName] = useYArray(slotArr as Y.Array<string>);
    }
  }

  return useMemo(() => ({ id: blockId, type, props, slots }), [blockId, type, props, slots]);
}

function useRootBlockIds(): string[] {
  const doc = usePageDocument();
  return useYArray(doc.rootBlocks);
}

function useRootProps(): Record<string, any> {
  const doc = usePageDocument();
  return useYMap(doc.root.get('props') as Y.Map<any>);
}
```

## Block Renderer

Components subscribe to their own block reactively and render children by ID:

```tsx
function BlockRenderer({ blockId }: { blockId: string }) {
  const doc = usePageDocument();
  const block = useBlock(blockId);
  const registry = useComponentRegistry();

  if (!block) return null;

  const Component = registry.get(block.type);
  if (!Component) return <UnknownBlock type={block.type} />;

  return (
    <BlockContext.Provider value={blockId}>
      <Component {...block.props}>
        {Object.entries(block.slots).map(([slotName, childIds]) => (
          <Slot key={slotName} name={slotName} parentId={blockId}>
            {childIds.map((childId) => (
              <BlockRenderer key={childId} blockId={childId} />
            ))}
          </Slot>
        ))}
      </Component>
    </BlockContext.Provider>
  );
}

function PageRenderer() {
  const rootIds = useRootBlockIds();

  return (
    <div className="page-root">
      {rootIds.map((id) => (
        <BlockRenderer key={id} blockId={id} />
      ))}
    </div>
  );
}
```

## Convex Sync Layer

### Schema

```ts
// convex/schema.ts
export default defineSchema({
  pages: defineTable({
    tenantId: v.string(),
    slug: v.string(),
    title: v.string(),
    content: v.any(),           // materialized SerializedPage for storefront
    yjsState: v.bytes(),        // binary Y.Doc state
    version: v.number(),
    status: v.union(v.literal('draft'), v.literal('published')),
    updatedAt: v.number(),
  })
    .index('by_tenant', ['tenantId'])
    .index('by_tenant_slug', ['tenantId', 'slug']),
});
```

### Sync Mutation

```ts
// convex/pages.ts
export const syncUpdate = mutation({
  args: {
    pageId: v.id('pages'),
    update: v.bytes(),
  },
  handler: async (ctx, { pageId, update }) => {
    const page = await ctx.db.get(pageId);
    if (!page) throw new ConvexError({ code: 'NOT_FOUND' });

    // Merge incoming Yjs delta with stored state
    const merged = Y.mergeUpdates([
      new Uint8Array(page.yjsState),
      new Uint8Array(update),
    ]);

    // Materialize for storefront reads
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, merged);
    const doc = new PageDocument(ydoc);
    const content = doc.toJSON();

    await ctx.db.patch(pageId, {
      yjsState: merged,
      content,
      version: page.version + 1,
      updatedAt: Date.now(),
    });
  },
});

export const getYjsState = query({
  args: { pageId: v.id('pages') },
  handler: async (ctx, { pageId }) => {
    const page = await ctx.db.get(pageId);
    if (!page) throw new ConvexError({ code: 'NOT_FOUND' });
    return { yjsState: page.yjsState, version: page.version };
  },
});
```

### Convex Yjs Provider

```ts
class ConvexYjsProvider {
  private unsubscribe: (() => void) | null = null;
  private isSyncing = false;

  constructor(
    private ydoc: Y.Doc,
    private convex: ConvexClient,
    private pageId: Id<'pages'>
  ) {
    // Send local changes to Convex
    ydoc.on('update', (update: Uint8Array, origin: any) => {
      if (origin === 'remote' || this.isSyncing) return;
      this.convex.mutation(api.pages.syncUpdate, {
        pageId: this.pageId,
        update,
      });
    });

    // Subscribe to remote changes via Convex reactive query
    this.unsubscribe = this.convex.onUpdate(
      api.pages.getYjsState,
      { pageId: this.pageId },
      (result) => {
        this.isSyncing = true;
        Y.applyUpdate(this.ydoc, new Uint8Array(result.yjsState), 'remote');
        this.isSyncing = false;
      }
    );
  }

  destroy() {
    this.unsubscribe?.();
    this.ydoc.destroy();
  }
}
```

## Undo/Redo

Yjs `UndoManager` replaces Puck's snapshot-based history stack. This is strictly better for collaborative editing — undoing your changes does not undo other users' concurrent changes.

```ts
// Initialized in PageDocument constructor
this.undoManager = new Y.UndoManager(
  [this.blocks, this.rootBlocks, this.root],
  {
    trackedOrigins: new Set(['local']),  // only track local changes
    captureTimeout: 500,                  // merge rapid changes into one undo step
  }
);
```

The `trackedOrigins` filter ensures that only mutations originating from `'local'` (the current user's actions) are pushed onto the undo stack. Remote changes that arrive via the Convex provider (origin `'remote'`) are excluded.

The `captureTimeout` merges rapid successive edits (e.g., typing characters quickly, dragging a slider) into a single undo step, matching user expectations.

## Awareness / Presence

Yjs ships an awareness protocol for cursor positions, selections, and user presence. This replaces custom Convex presence tracking for the editor context.

```ts
import { Awareness } from 'y-protocols/awareness';

const awareness = new Awareness(ydoc);

// Set local user state
awareness.setLocalStateField('user', {
  id: currentUser.id,
  name: currentUser.name,
  color: currentUser.color,
});

// Set selected block
awareness.setLocalStateField('selection', {
  blockId: selectedBlockId,
  field: activeFieldName,  // which field they're editing
});

// Observe other users
awareness.on('change', () => {
  const states = awareness.getStates();
  // Render presence indicators, cursors, selection highlights
});
```

Awareness state can be piped through Convex or kept on a lightweight side channel depending on latency requirements. For a page builder (where presence updates are less frequent than a text editor), Convex is likely sufficient.

## Conflict Resolution Semantics

Because the Y.Doc structure separates block data from block ordering, most concurrent operations are naturally non-conflicting:

| Scenario | Resolution |
|----------|-----------|
| Two users add blocks to different slots | Clean merge — independent Y.Array insertions |
| Two users add blocks to the same slot at different positions | Clean merge — Yjs array insertion semantics |
| Two users edit different props on the same block | Clean merge — independent Y.Map keys |
| Two users edit the same prop on the same block | Last-writer-wins per key (Yjs client ID) |
| One user moves a block, another edits its props | Clean merge — move is slot-level, edit is prop-level |
| One user deletes a block, another edits its props | Delete wins — prop edits on deleted block are no-ops |
| Two users move the same block to different slots | Both moves execute — block appears in last-write slot |
| User A types in a Y.Text heading while User B changes font color | Clean merge — Y.Text and Y.Map key are independent |
| Two users type in the same Y.Text field simultaneously | Character-level CRDT merge — both edits preserved |

## Storefront Read Path

The Cloudflare Worker reads the materialized `content` field. No Yjs awareness needed.

```ts
// Cloudflare Worker
async function handleRequest(request: Request) {
  const page = await convexClient.query(api.pages.getPublished, {
    tenantId,
    slug,
  });

  // page.content is a SerializedPage — plain JSON, no CRDTs
  const html = renderPage(page.content, componentRegistry);
  return new Response(html, {
    headers: { 'Content-Type': 'text/html' },
  });
}
```

## Compaction

Yjs documents grow with change history. Scheduled compaction keeps storage bounded.

```ts
// convex/crons.ts
export const compactYjsState = internalMutation({
  handler: async (ctx) => {
    const pages = await ctx.db
      .query('pages')
      .collect();

    for (const page of pages) {
      const state = new Uint8Array(page.yjsState);
      if (state.byteLength > 5_000_000) {  // 5MB threshold
        const ydoc = new Y.Doc();
        Y.applyUpdate(ydoc, state);
        const compacted = Y.encodeStateAsUpdate(ydoc);
        await ctx.db.patch(page._id, { yjsState: compacted });
      }
    }
  },
});

// Run nightly
crons.interval('compact-yjs', { hours: 24 }, internal.crons.compactYjsState);
```

## Fork Maintenance Strategy

### Package Structure

Keep changes isolated to minimize upstream merge conflicts:

```
@puckeditor/core           ← upstream, unmodified (git subtree or submodule)

@your-org/puck-crdt        ← your data layer
  src/
    PageDocument.ts         ← Y.Doc wrapper, all write methods
    hooks.ts                ← useBlock, useYMap, useYArray, useRootBlockIds
    provider.ts             ← ConvexYjsProvider
    awareness.ts            ← presence layer
    serialize.ts            ← toJSON, toBinary, fromBinary

@your-org/puck-editor      ← thin integration layer
  src/
    reducer.ts              ← rewired to call PageDocument methods
    context.tsx             ← PageDocumentProvider replaces Data context
    adapters/
      drop-zone.tsx         ← rewired DropZone reads from Y.Array
      draggable.tsx         ← rewired drag handlers call doc.moveBlock
      field-editor.tsx      ← rewired field editors call doc.updateProp
```

### Upstream Merge Process

1. Track upstream Puck releases in a `upstream/main` branch
2. Changes to UI components (DraggableComponent, fields, overlays) merge cleanly — they don't touch the state layer
3. Changes to the reducer or data utilities conflict — review and adapt to `PageDocument` API
4. Changes to `usePuck` hook — adapt selectors to read from Y.Doc hooks
5. New features (e.g., AI generation) — evaluate whether they can work with `PageDocument.addBlock()` directly

### Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Puck changes its internal `Data` shape | Irrelevant — we don't use `Data` anymore |
| Puck adds new reducer actions | Map each new action to a `PageDocument` method |
| Puck changes drag/drop internals | Likely compatible — just produces different action dispatches |
| Puck changes the override/plugin API | May need adapter updates — keep the integration layer thin |
| Upstream goes unmaintained | You already own the fork — full control |
| Upstream makes breaking changes | Pin to a known version, merge selectively |

## Migration Path

### Phase 1: Ship with Puck + Diff Bridge (current architecture)

Use the diff + Yjs approach from the companion architecture doc. This validates the product, the component registry, the storefront, and the Convex sync layer. Collaboration works via the bridge.

### Phase 2: Fork and Swap the State Layer

- Fork Puck
- Implement `PageDocument` and Y.Doc hooks
- Rewire the reducer
- Keep the editor UI untouched
- Swap the data layer behind the same `PageSyncProvider` abstraction

### Phase 3: Leverage Native CRDT Capabilities

- Add `Y.Text` props for collaborative rich text editing within blocks
- Add awareness-based presence (cursor positions, field focus indicators)
- Add Yjs `UndoManager` for per-user undo stacks
- Remove all diff/bridge code

## What This Eliminates

| Component | Status |
|-----------|--------|
| `diffPuckData` (walkTree-based diff) | Eliminated |
| `PageOperation` types | Eliminated |
| `applyToYDoc` (op → Yjs translation) | Eliminated |
| `ydocToPuckData` (Y.Doc → PuckData serialization) | Eliminated |
| LIS algorithm for move detection | Eliminated |
| Round-trip lossless serialization testing | Eliminated |
| onChange debouncing | Eliminated |
| Snapshot-based undo/redo | Replaced by Y.UndoManager |
| Custom presence tracking | Replaced by Yjs Awareness |

## Dependencies

- **yjs** — CRDT library (~13KB gzipped, no WASM)
- **y-protocols** — Awareness protocol
- **@puckeditor/core** — Forked, UI layer only
- **Convex** — Backend, reactive queries, mutations, sync transport
- **Cloudflare Workers** — Storefront rendering from materialized JSON

## File Structure

```
packages/
  puck-crdt/
    src/
      PageDocument.ts
      hooks.ts
      provider.ts
      awareness.ts
      serialize.ts
      types.ts
      __tests__/
        PageDocument.test.ts     ← unit tests for all write operations
        hooks.test.ts            ← React hook testing
        serialize.test.ts        ← toJSON / fromBinary round-trip
        concurrent.test.ts       ← multi-client merge scenarios

  puck-editor/
    src/
      reducer.ts
      context.tsx
      adapters/
        drop-zone.tsx
        draggable.tsx
        field-editor.tsx
      __tests__/
        reducer.test.ts          ← action → Y.Doc mutation verification

  puck-upstream/                   ← git subtree of @puckeditor/core

convex/
  pages.ts                         ← syncUpdate, getYjsState, getPublished
  schema.ts                        ← pages table with yjsState field
  crons.ts                         ← compaction
```
