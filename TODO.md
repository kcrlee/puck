# Puck Fork: Yjs CRDT State Layer — Task Tracker

> Replaces Puck's immutable snapshot state with native Yjs CRDTs.
> See [plans/puck-fork-architecture.md](plans/puck-fork-architecture.md) for full design rationale.

---

## Phase 1: Foundation — PageDocument + Hooks

No existing code is modified. All new files under `packages/core/crdt/`.

- [x] **1.1 Add Yjs dependencies**
  `packages/core/package.json` — add `yjs`, `y-protocols`
  > Ref: [Architecture § Dependencies](plans/puck-fork-architecture.md#dependencies) — yjs ~13KB gzip, no WASM

- [x] **1.2 Create `packages/core/crdt/PageDocument.ts`**
  Y.Doc wrapper class with all read/write methods and undo support.
  > Ref: [Architecture § PageDocument API](plans/puck-fork-architecture.md#pagedocument-api) — full class definition
  > Ref: [Architecture § Y.Doc Structure](plans/puck-fork-architecture.md#ydoc-structure) — flat block store rationale

  Sub-tasks:
  - [x] Y.Doc structure: `Y.Map('blocks')`, `Y.Array('rootBlocks')`, `Y.Map('root')`, `Y.Map('meta')`
  - [x] Read methods: `getBlock`, `getBlockType`, `getBlockProps`, `getSlotChildren`, `getRootBlockIds`, `getText`
  - [x] Write methods: `addBlock`, `removeBlock`, `moveBlock`, `updateProp`, `updateRootProp`
  - [x] `duplicateBlock` — deep clone with new IDs (not in architecture doc, needed for `duplicate` action)
  - [x] `ParentIndex` — reactive `Map<string, { parentId, slotName, index }>` maintained by observing slot Y.Arrays. Replaces the O(n) `findParent()` scan in the architecture doc with O(1) lookup.
  - [x] `Y.UndoManager` — scoped to `[blocks, rootBlocks, root]`, `trackedOrigins: new Set(['local'])`, `captureTimeout: 500`
    > Ref: [Architecture § Undo/Redo](plans/puck-fork-architecture.md#undoredo)
  - [x] `static fromPuckData(data, config)` — convert Puck `Data` shape (nested `content`, `zones`, slot props) into flat Y.Doc model
  - [x] `toPuckData()` — materialize Y.Doc back to Puck `Data` shape (needed for Phase 2 compat bridge)
  - [x] `toJSON(): SerializedPage`, `toBinary(): Uint8Array`
    > Ref: [Architecture § Serialization](plans/puck-fork-architecture.md#serialized-types-for-storefront-rendering)
  - [x] Fix `_propsToYMap` to handle arrays (architecture doc only handles objects) — use `Y.Array` for plain JS arrays

- [x] **1.3 Create `packages/core/crdt/hooks.ts`**
  Reactive Y.Doc observation hooks using `useSyncExternalStore` (not `useState`+`useEffect`).
  > Ref: [Architecture § React Hooks](plans/puck-fork-architecture.md#react-hooks-reactive-ydoc-observation) — hook signatures and observation patterns

  Sub-tasks:
  - [x] `useYMap(ymap)` — subscribes to `ymap.observeDeep`, returns stable snapshot
  - [x] `useYMapValue<T>(ymap, key)` — subscribes to single key changes only
  - [x] `useYArray<T>(yarray)` — subscribes to array mutations
  - [x] `useBlock(blockId)` — returns `{ id, type, props, slots }` reactive to that block only
  - [x] `useRootBlockIds()` — reactive to root ordering changes
  - [x] `useRootProps()` — reactive to root settings
  - [x] `useSlotChildren(blockId, slotName)` — returns child ID array for one slot

- [x] **1.4 Create supporting files**
  - [x] `packages/core/crdt/types.ts` — `SerializedPage`, `SerializedBlock`, `BlockLocation`, `ParentIndexEntry`
    > Ref: [Architecture § Serialized Types](plans/puck-fork-architecture.md#serialized-types-for-storefront-rendering)
  - [x] `packages/core/crdt/context.tsx` — `PageDocumentContext`, `PageDocumentProvider`, `usePageDocument()`
    > Ref: [Architecture § Page document context](plans/puck-fork-architecture.md#react-hooks-reactive-ydoc-observation)
  - [x] `packages/core/crdt/index.ts` — barrel export

- [x] **1.5 Unit tests**
  - [x] `packages/core/crdt/__tests__/PageDocument.test.ts`
    - CRUD: addBlock, removeBlock, moveBlock, duplicateBlock, updateProp, updateRootProp
    - ParentIndex consistency after every mutation type
    - `fromPuckData` / `toPuckData` round-trip (slot content + legacy DropZone zones)
    - Undo/redo via Y.UndoManager
    - Two-client concurrent merge (two Y.Docs applying each other's updates)
      > Ref: [Architecture § Conflict Resolution Semantics](plans/puck-fork-architecture.md#conflict-resolution-semantics) — merge scenarios table
  - [x] `packages/core/crdt/__tests__/hooks.test.ts` — React hook reactivity with Testing Library

### Phase 1 verification
- [x] All `packages/core/crdt/__tests__/` tests pass (31 PageDocument + 11 hooks = 42 tests)
- [x] No existing Puck tests broken (nothing was modified)

---

## Phase 2: Compatibility Bridge — Wire Y.Doc into AppStore

The compat bridge materializes Y.Doc state back into Puck's `state.data` + `state.indexes` shape so all existing components render correctly without modification.

- [x] **2.1 Add `pageDocument` to AppStore**
  `packages/core/store/index.ts`
  - [x] Add `pageDocument: PageDocument` to `AppStore` type
  - [x] In `createAppStore()`, accept optional `Y.Doc`, construct `PageDocument`
  - [x] Initialize Y.Doc from `initialAppStore.state.data` via `PageDocument.fromPuckData()`

- [x] **2.2 Create `packages/core/crdt/compat.ts`**
  `materializeAppState(doc: PageDocument, uiState: UiState): PrivateAppState`
  - [x] Calls `doc.toPuckData()` to produce `Data` object
  - [x] Builds `NodeIndex` and `ZoneIndex` from PageDocument's flat block store + parent index
  - [x] Returns `{ data, ui: uiState, indexes: { nodes, zones } }`

- [~] **2.3 Y.Doc observation -> Zustand sync**
  `packages/core/store/index.ts`
  - [~] Approach changed: instead of Y.Doc→Zustand observation, we sync Zustand→Y.Doc after each dispatch via `syncDocFromState()` in `packages/core/crdt/sync.ts`. Reverse direction (Y.Doc→Zustand via `materializeAppState`) used by history undo/redo.
  - [ ] On `ydoc.on('afterTransaction', ...)`, call `set({ state: materializeAppState(...) })` — deferred until Y.Doc becomes authoritative
  - [ ] Batch updates — only materialize when at least one Y.Doc shared type changed

- [~] **2.4 Rewire `dispatch` to mutate Y.Doc**
  `packages/core/store/index.ts` (currently lines 154-172)
  - [~] Approach changed: reducer remains authoritative, `syncDocFromState()` called after each dispatch to keep Y.Doc in sync. Direct Y.Doc-first dispatch deferred due to edge cases with root slots and legacy DropZones.
  - [ ] Data-mutating actions (`insert`, `remove`, `move`, `reorder`, `replace`, `replaceRoot`, `duplicate`, `set`, `setData`) route to `dispatchToYDoc()`
  - [ ] UI-only actions (`setUi`) stay in Zustand as-is
  - [ ] Zone registration (`registerZone`, `unregisterZone`) become no-ops or minimal slot ensures
  - [ ] `onAction` callback continues to fire with materialized state

- [~] **2.5 Create `packages/core/crdt/dispatch.ts`**
  Action-to-PageDocument mapping for each of Puck's 12 reducer action types.
  > Ref: [Architecture § Puck Reducer Transformation](plans/puck-fork-architecture.md#puck-reducer-transformation) — before/after patterns
  > Note: File created with helpers (`parseZoneCompound`, `getBlockIdAtIndex`, `buildSlotDefs`) but per-action mapping deferred — sync bridge approach means reducer handles actions.

  Per-action tasks:
  - [x] `insert` -> `doc.addBlock()` — recursive helper adds block + default slot children via PageDocument
  - [x] `remove` -> `doc.removeBlock()` — resolve block ID from zone+index via `getBlockIdAtIndex`
  - [x] `move` -> `doc.moveBlock()` — parse source/destination zone compounds
  - [x] `reorder` -> `doc.moveBlock()` — same slot, different index (delegates to move action)
  - [~] `replace` -> reducer still exists but callers migrated to `doc.updateProps` + `commitDocToStore` (Phase 4.4). Reducer path retained as fallback; post-dispatch `syncDocFromState` only fires for this action type.
  - [~] `replaceRoot` -> reducer still exists but callers migrated to `doc.updateRootProps` + `commitDocToStore` (Phase 4.4). Same as `replace`.
  - [x] `duplicate` -> `doc.duplicateBlock()` — deep clone + insert after source
  - [~] `set` -> deferred — wholesale state replacement, post-dispatch `syncDocFromState` keeps Y.Doc in sync. Will simplify when callers migrate (Phase 4/5).
  - [~] `setData` -> deferred — wholesale data replacement, same reasoning as `set`.
  - [~] `registerZone` -> deferred — legacy DropZone lifecycle. Becomes no-op when DropZone reads from Y.Doc (Phase 4.2).
  - [~] `unregisterZone` -> deferred — legacy DropZone lifecycle. Same as `registerZone`.

### Phase 2 verification
- [x] `yarn test` in `packages/core` — all existing tests pass (172 tests, 31 suites)
- [ ] `yarn dev` — demo app works identically: insert, move, delete, field edits, undo
- [x] Y.Doc is being mutated on every dispatch (via `syncDocFromState` after reducer)

---

## Phase 3: Replace History with Y.UndoManager

> Ref: [Architecture § Undo/Redo](plans/puck-fork-architecture.md#undoredo) — Y.UndoManager replaces snapshot history, `trackedOrigins` ensures only local changes are undoable

- [x] **3.1 Rewrite HistorySlice**
  `packages/core/store/slices/history.ts`
  - [x] `record()` -> no-op (Y.UndoManager tracks automatically)
  - [x] `back()` -> `doc.undo()` + `materializeAppState()` to rebuild state from Y.Doc
  - [x] `forward()` -> `doc.redo()` + `materializeAppState()` to rebuild state from Y.Doc
  - [x] `hasPast()` -> `doc.canUndo()`
  - [x] `hasFuture()` -> `doc.canRedo()`
  - [x] `setHistories`, `setHistoryIndex` kept for backward compat (dispatch `set` action)
  - [x] `back()` clears `itemSelector` to avoid stale selections after undo
  - [x] `syncDocFromState` origin changed from `"sync"` to `"local"` so Y.UndoManager tracks dispatch changes

- [~] **3.2 Remove storeInterceptor history recording**
  `packages/core/reducer/index.ts`
  - [~] `storeInterceptor` still exists but `record()` is no-op, so history recording is effectively dead code. Full removal deferred.

- [x] **3.3 Remove initialHistory prop and legacy history API**
  - [x] Removed `initialHistory` prop from `PuckProps` and `InitialHistory` type
  - [x] Removed `blendedHistories` construction and `walkAppState` per-history-entry calls
  - [x] Removed `setHistories`, `setHistoryIndex`, `initialAppState`, `histories`, `index`, `record`, `currentHistory`, `prevHistory`, `nextHistory` from `HistorySlice`
  - [x] Removed `record` parameter from `createReducer` and `storeInterceptor`
  - [x] Simplified `useRegisterHistorySlice` to only register hotkeys
  - [x] Cleaned up `usePuck` history API surface to only expose `back`, `forward`, `hasPast`, `hasFuture`

- [x] **3.4 Keep hotkey bindings**
  `packages/core/store/slices/history.ts` — `useRegisterHistorySlice`
  - [x] Ctrl+Z / Cmd+Z -> `back()` (now calls `doc.undo()`)
  - [x] Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y / Cmd+Y -> `forward()` (now calls `doc.redo()`)

### Phase 3 verification
- [ ] Undo/redo works via keyboard shortcuts (manual testing needed)
- [ ] Undo only reverts local changes (simulate remote Y.Doc update, confirm it's not undone)
- [ ] Rapid edits (typing, slider drags) group into single undo steps via `captureTimeout: 500`
- [x] History tests pass (7 tests covering undo, redo, no-past, no-future, redo-stack-clear, stale-selection-clear)
- [x] All 168 tests pass after removing legacy history API

---

## Phase 4: Migrate Consumer Components to Y.Doc Hooks

Incremental migration — compat bridge keeps both read paths working simultaneously.

- [x] **4.1 Change `itemSelector` from position-based to ID-based**
  Critical for collaboration safety — position-based selection shifts when others insert/remove.
  - [x] `packages/core/lib/data/get-item.ts` — `ItemSelector` changed from `{ index, zone }` to `{ id: string }`, `getItem` does node lookup by ID
  - [x] `packages/core/lib/get-selector-for-id.ts` — `getSelectorForId` returns `{ id }`, added `getPositionForId` for action dispatch zone+index lookups
  - [x] Updated all ~24 consumer files: DraggableComponent, DragDropContext, LayerTree, useBreadcrumbs, Fields, InlineTextField, rich-text-transform, insert-component, move-component, use-delete-hotkeys, duplicate action, resolve-and-replace-data, use-puck
  - [x] All 168 tests pass

- [ ] **4.2 DropZone**
  `packages/core/components/DropZone/index.tsx`
  > Ref: [Architecture § Block Renderer](plans/puck-fork-architecture.md#block-renderer) — BlockRenderer pattern with useBlock + slot iteration
  > **Blocked:** Current Y.Doc hooks (`useBlock`, `useSlotChildren`) fire on ALL doc changes via `doc.subscribe()` / `observeDeep` on the entire blocks map. Using them in `DropZoneChild` would make re-renders *worse* than current Zustand `useShallow` selectors. Requires per-block granular observation hooks first (see Phase 5 note).
  - [ ] `DropZoneEdit`: Replace `useAppStore(s => s.state.indexes.zones[zoneCompound]?.contentIds)` with `useSlotChildren(parentBlockId, slotName)`
  - [ ] `DropZoneChild`: Replace `useAppStore(s => s.state.indexes.nodes[id]?.flatData.props)` with `useBlock(id)`. Remove `expandNode` call.
  - [ ] Remove `registerZone`/`unregisterZone` dispatch calls
  - [ ] Preview system (`useContentIdsWithPreview`, `ZoneStore`) unchanged — transient drag UI

- [ ] **4.3 DraggableComponent**
  `packages/core/components/DraggableComponent/index.tsx`
  - [ ] Selection onClick: use ID-based `itemSelector`
  - [ ] Duplicate: `doc.duplicateBlock(id)` instead of `dispatch({ type: "duplicate" })`
  - [ ] Delete: `doc.removeBlock(id)` instead of `dispatch({ type: "remove" })`
  - [ ] Parent selection: `doc.findParent(id)` via parent index
  - [ ] `useSortable` data: derive `zone`, `index`, `path` from Y.Array + parent index
  - [ ] `registerNode` (DOM) stays in Zustand `NodesSlice` — unchanged

- [x] **4.4 Field Editors**
  `packages/core/components/Puck/components/Fields/index.tsx`
  > Ref: [Architecture § Puck Reducer Transformation](plans/puck-fork-architecture.md#puck-reducer-transformation) — `setProp` case becomes `doc.updateProp()`
  - [x] `createOnChange`: Uses `doc.updateProps(blockId, nonSlotProps)` + `commitDocToStore()` for both selected items and root
  - [x] `InlineTextField`: Uses `doc.updateProps` + `commitDocToStore` instead of `dispatch({ type: "replace" })`
  - [x] `rich-text-transform`: Uses `doc.updateProps` + `commitDocToStore` instead of `dispatch({ type: "replace" })`
  - [x] `insert-component.ts`: Post-resolve replace uses `doc.updateProps` + `commitDocToStore`
  - [x] `move-component.ts`: Post-resolve replace uses `doc.updateProps` + `commitDocToStore`
  - [x] `resolve-and-replace-data.ts`: Refactored to accept `AppStoreApi`, uses `doc.updateProps` + `commitDocToStore`
  - [x] `resolveAndCommitData` in store: Uses `doc.updateProps`/`doc.updateRootProps` + `materializeAppState` directly
  - [ ] `fieldContextStore`: subscribe to block's Y.Map instead of `appStore` state changes (deferred — requires per-block granular hooks)

- [ ] **4.5 DragDropContext**
  `packages/core/components/DragDropContext/index.tsx`
  - [ ] `onDragEnd`: Replace `insertComponent()`/`dispatch({ type: "move" })` with `doc.addBlock()`/`doc.moveBlock()`
  - [ ] `onDragOver`: Path-based cycle detection uses parent index ancestry
  - [ ] `ZoneStore` (preview system) unchanged — transient drag UI

- [ ] **4.6 Slot Transforms**
  `packages/core/lib/field-transforms/default-transforms/slot-transform.tsx`
  - [ ] Edit mode: `DropZoneEditPure` internally uses `useSlotChildren`
  - [ ] Render mode: receives content from `doc.toJSON()` snapshot

- [~] **4.7 Store slices**
  - [x] `PermissionsSlice` (`packages/core/store/slices/permissions.ts`): uses `doc.findParent()` for parent ID lookup (falls back to Zustand nodes when doc is stale)
  - [x] `FieldsSlice` (`packages/core/store/slices/fields.ts`): uses `doc.findParent()` for parent ID lookup (falls back to Zustand nodes when doc is stale)
  - [ ] Full migration to `doc.getBlock()` for component data deferred — user-facing callbacks expect materialized `ComponentData` shape (slot children as arrays of ComponentData), not `SerializedBlock` (slot child IDs)

- [~] **4.8 usePuck hook**
  `packages/core/lib/use-puck.ts`
  - [x] `getItemById`: reads from Y.Doc via `doc.getBlock(id)`, reconstructs ComponentData shape, falls back to Zustand nodes
  - [x] `getParentById`: uses `doc.findParent(id)` for parent lookup, reads parent data from Zustand nodes
  - [x] `resolveDataById`/`resolveDataBySelector`: accept `AppStoreApi` (not `getState`), pass through to `resolveAndReplaceData`
  - [ ] `appState.data`: still uses `makeStatePublic(store.state)` — lazy Y.Doc materialization deferred to Phase 5
  - [x] `dispatch`: still works for backward compat

### Phase 4 verification
- [x] All 172 existing tests pass (after Steps 4.1, 4.4, 4.7, 4.8)
- [x] Core package builds successfully
- [ ] Manual testing: insert, drag-and-drop, field edits, duplicate, delete, nested slots
- [ ] Verify surgical re-renders: React DevTools profiler confirms editing one block doesn't re-render siblings — **blocked on per-block granular Y.Doc hooks (see 4.2 note)**

### Phase 4 — Key APIs added
- `PageDocument.updateProps(blockId, props)` — batch prop update in single Y.Doc transaction
- `PageDocument.updateRootProps(props)` — batch root prop update in single Y.Doc transaction
- `commitDocToStore(appStoreApi, options?)` — materializes Y.Doc → Zustand after direct doc mutations
- `PageDocumentProvider` wired into Puck component tree (inside `appStoreContext.Provider`)
- **Critical pattern:** When calling `doc.updateProps`, always filter out slot-type fields (check `config.components[type].fields[k].type === "slot"`) — slots are stored as separate Y.Array structures in Y.Doc

---

## Phase 5: Remove Compatibility Bridge

All consumers now read from Y.Doc directly. The materialization step is no longer needed.

- [ ] **5.0 Per-block granular Y.Doc hooks** *(prerequisite for 4.2 DropZone migration)*
  Current hooks (`useBlock`, `useSlotChildren`) subscribe via `doc.subscribe()` which fires `_notifyObservers()` on ANY Y.Doc change (blocks, rootBlocks, rootSlots, rootProps all trigger it). Need per-block observation:
  - [ ] `useBlock(id)` should observe only the specific block's Y.Map, not the entire `blocks` Y.Map
  - [ ] `useSlotChildren(blockId, slotName)` should observe only that slot's Y.Array
  - [ ] Consider splitting `_observeSlots` into targeted observers per block/slot

- [ ] **5.1 Remove compat bridge materialization**
  - [ ] Remove `materializeAppState` from Y.Doc observation handler in `packages/core/store/index.ts`
  - [ ] Remove `packages/core/crdt/compat.ts`

- [ ] **5.2 Remove `state.data` and `state.indexes` from AppStore**
  - [ ] `packages/core/store/index.ts` — remove from type and initialization
  - [ ] Make `toPuckData()` lazy (only called when `onChange` or `usePuck().appState` is accessed)

- [ ] **5.3 Remove legacy data utilities**
  - [ ] `packages/core/lib/data/walk-app-state.ts` — remove (replaced by flat Y.Doc structure)
  - [ ] `packages/core/lib/data/make-state-public.ts` — remove
  - [ ] `packages/core/lib/data/flatten-data.ts` — remove
  - [ ] `packages/core/lib/data/flatten-node.ts` — remove

- [ ] **5.4 Gut reducer**
  - [ ] `packages/core/reducer/index.ts` — reduce to only handle `setUi`
  - [ ] Remove individual action files that are now no-ops

- [ ] **5.5 Final AppStore shape**
  `{ ui, config, pageDocument, nodes (DOM), permissions, fields, componentState, ... }`

### Phase 5 verification
- [ ] `state.data` and `state.indexes` no longer exist on AppStore
- [ ] Bundle size decrease (removed walkAppState, flattenData, makeStatePublic, deep-diff)
- [ ] All tests pass
- [ ] Demo app fully functional

---

## Phase 6: Convex Sync Provider

Application layer — outside `packages/core`, in the consuming app.

> Ref: [Architecture § Convex Sync Layer](plans/puck-fork-architecture.md#convex-sync-layer) — schema, syncUpdate mutation, getYjsState query
> Ref: [Architecture § Convex Yjs Provider](plans/puck-fork-architecture.md#convex-yjs-provider) — ConvexYjsProvider class

- [ ] **6.1 Convex schema**
  `convex/schema.ts` — `pages` table with `yjsState: v.bytes()`, `content: v.any()` (materialized JSON), `version: v.number()`

- [ ] **6.2 Sync mutation**
  `convex/pages.ts` — `syncUpdate`: merge incoming Yjs delta with stored state, materialize `content` for storefront
  > Ref: [Architecture § Sync Mutation](plans/puck-fork-architecture.md#sync-mutation)

- [ ] **6.3 ConvexYjsProvider**
  - [ ] `ydoc.on('update')` -> Convex `syncUpdate` mutation (skip remote-origin updates)
  - [ ] `convex.onUpdate(getYjsState)` -> `Y.applyUpdate(ydoc, state, 'remote')`

- [ ] **6.4 Compaction cron**
  `convex/crons.ts` — nightly re-encode of Y.Docs over 5MB threshold
  > Ref: [Architecture § Compaction](plans/puck-fork-architecture.md#compaction)

- [ ] **6.5 Awareness / Presence**
  > Ref: [Architecture § Awareness / Presence](plans/puck-fork-architecture.md#awareness--presence)
  - [ ] Yjs Awareness protocol for cursor positions, selection highlights, user presence
  - [ ] Pipe awareness through Convex (sufficient latency for page builder use case)

- [ ] **6.6 Storefront read path**
  > Ref: [Architecture § Storefront Read Path](plans/puck-fork-architecture.md#storefront-read-path)
  - [ ] Cloudflare Worker reads materialized `content` field — no Yjs needed at read time

### Phase 6 verification
- [ ] Two browser tabs editing the same page: changes sync in real-time
- [ ] Undo in one tab doesn't revert the other tab's changes
- [ ] Refresh a tab: state restored from Convex yjsState
- [ ] Storefront renders from materialized JSON without Yjs dependency

---

## What Gets Eliminated

> Ref: [Architecture § What This Eliminates](plans/puck-fork-architecture.md#what-this-eliminates)

| Component | Status |
|-----------|--------|
| `diffPuckData` (walkTree-based diff) | Eliminated |
| `PageOperation` types | Eliminated |
| `applyToYDoc` (op -> Yjs translation) | Eliminated |
| `ydocToPuckData` (Y.Doc -> PuckData serialization) | Eliminated |
| LIS algorithm for move detection | Eliminated |
| Round-trip lossless serialization testing | Eliminated |
| onChange debouncing | Eliminated |
| Snapshot-based undo/redo | Replaced by Y.UndoManager |
| Custom presence tracking | Replaced by Yjs Awareness |
| `walkAppState` index computation | Replaced by flat Y.Doc + ParentIndex |
| `makeStatePublic` / `flattenData` / `flattenNode` | Removed |
| Full `Data` cloning on every action | Eliminated |
