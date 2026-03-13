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

- [x] **4.2 DropZone**
      `packages/core/components/DropZone/index.tsx`

  > Ref: [Architecture § Block Renderer](plans/puck-fork-architecture.md#block-renderer) — BlockRenderer pattern with useBlock + slot iteration

  - [x] `DropZoneEdit`: Replaced `useAppStore(s => s.state.indexes.zones[zoneCompound]?.contentIds)` with `useSlotChildren(parentBlockId, slotName)` — parses zone compound to extract blockId/slotName
  - [x] `DropZoneChild`: Replaced `useAppStore(s => s.state.indexes.nodes[id]?.flatData.props)` + `nodeType` + `nodeReadOnly` with single `useBlock(id)`. Removed `expandNode` (Y.Doc props are already unflattened).
  - [x] `PageDocument.getSlotChildren("root", "default-zone")` — returns `rootBlocks.toArray()` (was reading from wrong Y.Map)
  - [x] `PageDocument.subscribeSlot("root", "default-zone")` — delegates to `subscribeRootBlocks`
  - [~] `registerZone`/`unregisterZone` dispatch calls kept — `zoneType` read still needed for legacy DropZone detection/deprecation warning
  - [x] Preview system (`useContentIdsWithPreview`, `ZoneStore`) unchanged — transient drag UI

- [x] **4.3 DraggableComponent**
      `packages/core/components/DraggableComponent/index.tsx`

  - [x] Selection onClick: already uses ID-based `itemSelector` (done in 4.1)
  - [x] Duplicate: `doc.duplicateBlock(id)` + `commitDocToStore()` — bypasses dispatch entirely
  - [x] Delete: `doc.removeBlock(id)` + `commitDocToStore()` — bypasses dispatch entirely
  - [x] Parent selection: `doc.findParent(id)` via parent index instead of `state.indexes.nodes`
  - [x] Fixed stale `getItem({ index, zone })` call to use `getItem({ id })` (missed in 4.1)
  - [~] `useSortable` data: still derives from props/store — deferred until DropZone migration
  - [x] `registerNode` (DOM) stays in Zustand `NodesSlice` — unchanged
  - [x] `setUi` dispatches kept as-is (UI-only action)

- [x] **4.4 Field Editors**
      `packages/core/components/Puck/components/Fields/index.tsx`

  > Ref: [Architecture § Puck Reducer Transformation](plans/puck-fork-architecture.md#puck-reducer-transformation) — `setProp` case becomes `doc.updateProp()`

  - [x] `createOnChange`: Uses `doc.updateProps(blockId, nonSlotProps)` + `commitDocToStore()` for both selected items and root
  - [x] `InlineTextField`: Uses `doc.updateProps` + `commitDocToStore` instead of `dispatch({ type: "replace" })`
  - [x] `rich-text-transform`: Uses `doc.updateProps` + `commitDocToStore` instead of `dispatch({ type: "replace" })`
  - [x] `insert-component.ts`: Fully bypasses dispatch — uses `addBlockToDoc` + `commitDocToStore` for insert, `doc.updateProps` + `commitDocToStore` for resolver
  - [x] `move-component.ts`: Fully bypasses dispatch — uses `doc.moveBlock` + `commitDocToStore` for move, `doc.updateProps` + `commitDocToStore` for resolver
  - [x] `resolve-and-replace-data.ts`: Refactored to accept `AppStoreApi`, uses `doc.updateProps` + `commitDocToStore`
  - [x] `resolveAndCommitData` in store: Uses `doc.updateProps`/`doc.updateRootProps` + `materializeAppState` directly
  - [ ] `fieldContextStore`: subscribe to block's Y.Map instead of `appStore` state changes (deferred — requires per-block granular hooks)

- [x] **4.5 DragDropContext**
      `packages/core/components/DragDropContext/index.tsx`

  - [x] `onDragEnd`: Success-path `dispatch({ type: "move" })` replaced with `moveComponent()` (consistent with cancelled path, both now bypass dispatch)
  - [x] `onDragOver`: Cycle detection now walks ancestor chain via `doc.findParent()` instead of `state.indexes.nodes[id]?.path`
  - [x] `ZoneStore` (preview system) unchanged — transient drag UI
  - [x] `setUi` dispatches kept as-is (UI-only action)
  - [x] Extracted `addBlockToDoc` helper to `crdt/dispatch.ts` (shared by `insertAction` reducer and `insertComponent`)

- [x] **4.6 Slot Transforms**
      `packages/core/lib/field-transforms/default-transforms/slot-transform.tsx`

  - [x] Edit mode: `DropZoneEditPure` internally uses `useSlotChildren` (done in 4.2)
  - [x] Render mode: `ContextSlotRender` uses `useSlotChildren(componentId, zone)` for content IDs from Y.Doc. Block data still read from Zustand `indexes.nodes` (full nested ComponentData needed by render pipeline's `useSlots` → `getSlotTransform` chain).

- [~] **4.7 Store slices**

  - [x] `PermissionsSlice` (`packages/core/store/slices/permissions.ts`): uses `doc.findParent()` for parent ID lookup (falls back to Zustand nodes when doc is stale)
  - [x] `FieldsSlice` (`packages/core/store/slices/fields.ts`): fully migrated — reads component data, parent, and root from Y.Doc via `doc.getBlock()`, `doc.getLocation()`, `doc.getRootPropsJSON()`; subscribes via `doc.subscribeBlock(id)` / `doc.subscribeRootProps()` with microtask-deferred, snapshot-deduplicated callbacks
  - [ ] Permissions slice full migration deferred — still reads `state.data` for `flattenData` iteration

- [~] **4.8 usePuck hook**
  `packages/core/lib/use-puck.ts`
  - [x] `getItemById`: reads from Y.Doc via `doc.getBlock(id)`, reconstructs ComponentData shape, falls back to Zustand nodes
  - [x] `getParentById`: uses `doc.findParent(id)` for parent lookup, reads parent data from Zustand nodes
  - [x] `resolveDataById`/`resolveDataBySelector`: accept `AppStoreApi` (not `getState`), pass through to `resolveAndReplaceData`
  - [ ] `appState.data`: still uses `makeStatePublic(store.state)` — lazy Y.Doc materialization deferred to Phase 5
  - [x] `dispatch`: still works for backward compat

### Phase 4 verification

- [x] All 176 tests pass (after Steps 4.1–4.6, 4.7, 4.8, 5.0, + 5.1 migrations)
- [x] Core package builds successfully
- [ ] Manual testing: insert, drag-and-drop, field edits, duplicate, delete, nested slots
- [ ] Verify surgical re-renders: React DevTools profiler confirms editing one block doesn't re-render siblings — **unblocked by Phase 5.0 granular hooks**

### Phase 4 — Additional component migrations (toward Phase 5.1)

- [x] `LayerTree` — `nodeData` → `useBlock(itemId)`, `zonesForItem` → derived from `block.slots` keys, `contentIds` → `useSlotChildren`, `childIsSelected` → `doc.findParent()` ancestor walk, label → `useBlock` for parent type
- [x] `Header` — root title now reads from `useRootProps()` instead of `indexes.nodes["root"]`
- [x] `use-min-empty-height` — zone content length reads from `doc.getSlotChildren()` instead of `indexes.zones`
- [x] `DraggableComponent.path` / `DropZone.path` — added `PageDocument.getPath(id)` (walks parent index to build zone compound ancestry), replaced `useAppStore(s.state.indexes.nodes[id]?.path)` with `useMemo(() => doc.getPath(id))`
- [x] `InlineTextField` — imperative reads now use `doc.getBlockType()`, `doc.getBlock()` instead of `indexes.nodes`
- [x] `useBreadcrumbs` — path from `doc.getPath()`, block type from `doc.getBlockType()` instead of `indexes.nodes`
- [x] `useParent` — uses `doc.findParent()` + `doc.getBlock()` instead of `indexes.nodes`
- [x] `rich-text-transform` — imperative reads now use `doc.getBlock()` instead of `indexes.nodes`
- [x] `resolve-data-by-id` — uses `doc.getBlock()` instead of `indexes.nodes`
- [x] `resolve-and-replace-data` — existence check uses `doc.getBlock()` instead of `indexes.nodes`
- [x] `ContextSlotRender` — fully refactored to `ContextSlotRenderItem` pattern: reads per-block from Y.Doc via `useBlock(id)`, recursively creates `ContextSlotRender` for slot fields. No longer reads `indexes.nodes`.
- [x] `Preview` — root data now reads from `useRootProps()` hook instead of `s.state.data.root`
- [x] `Fields/createOnChange` — root props from `doc.getRootPropsJSON()`, root readOnly from `doc.getRootPropsJSON().__readOnly`
- [x] `get-selector-for-id.ts` — rewritten to use `PageDocument` (`findParent`, `getSlotChildren`) instead of `PrivateAppState`
- [x] `move-component.ts` — component data from `doc.getBlock()` instead of `state.indexes.nodes`
- [x] `insert-component.ts` — item data from `doc.getBlock()` instead of `getItem()`
- [x] `use-delete-hotkeys.ts` — position from `doc.findParent()` + `doc.getSlotChildren()` instead of `state.indexes`
- [x] `store/index.ts` — `selectedItem` now derived from Y.Doc via `blockToComponentData()` in all paths (`commitDocToStore`, `dispatch`, `setUi`, `resolveAndCommitData`, initial)
- [x] `store/index.ts` — `getCurrentData()` root fallback reads from `doc.getRootPropsJSON()` instead of `state.data.root`
- [x] `store/index.ts` — `resolveComponentData` parent lookup uses `blockToFullComponentData()` from Y.Doc instead of `state.indexes.nodes`
- [x] `store/index.ts` — `getItem` import removed (no longer used in store)
- [x] `store/slices/fields.ts` — fully migrated: reads component data, parent, and root from Y.Doc; subscribes to `doc.subscribeBlock(id)` / `doc.subscribeRootProps()` instead of Zustand `s.state.indexes.nodes[id]`. Uses `queueMicrotask` + JSON snapshot deduplication to handle `syncDocFromState` noise.
- Remaining `indexes.nodes` reads in components (1): `DropZone.zoneType` (legacy detection)
- Remaining `indexes.nodes`/`indexes.zones` reads: `getItem.ts` (still used by history, DragDropContext, DraggableComponent, use-puck, resolve-data-by-selector), store slices (permissions), reducer actions (replace, register-zone), `find-zones-for-area.ts`, `get-ids-for-parent.ts`

### Phase 4 — Key APIs added

- `PageDocument.updateProps(blockId, props)` — batch prop update in single Y.Doc transaction
- `PageDocument.updateRootProps(props)` — batch root prop update in single Y.Doc transaction
- `commitDocToStore(appStoreApi, options?)` — materializes Y.Doc → Zustand after direct doc mutations
- `PageDocumentProvider` wired into Puck component tree (inside `appStoreContext.Provider`)
- `PageDocument.getPath(id)` — walks parent index to build zone compound ancestry array
- **Critical pattern:** When calling `doc.updateProps`, always filter out slot-type fields (check `config.components[type].fields[k].type === "slot"`) — slots are stored as separate Y.Array structures in Y.Doc

---

## Phase 5: Remove Compatibility Bridge

Prerequisite: All component-level consumers must read from Y.Doc. Several still read from `indexes.nodes`/`indexes.zones` (see Phase 4 additional migrations list above). `commitDocToStore` still calls `materializeAppState` to rebuild Zustand state after doc mutations.

- [x] **5.0 Per-block granular Y.Doc hooks** _(prerequisite for 4.2 DropZone migration)_
      Hooks now subscribe via targeted `subscribeBlock`/`subscribeSlot`/`subscribeRootBlocks`/`subscribeRootProps` methods instead of blanket `doc.subscribe()`.

  - [x] `useBlock(id)` — observes only that block via `doc.subscribeBlock(id)`. Editing block A does NOT re-render `useBlock(B)`.
  - [x] `useSlotChildren(blockId, slotName)` — observes only that slot via `doc.subscribeSlot(blockId, slotName)`.
  - [x] `useRootBlockIds()` — observes only root block ordering via `doc.subscribeRootBlocks()`.
  - [x] `useRootProps()` — observes only root props via `doc.subscribeRootProps()`.
  - [x] `_observeSlots` rewritten to parse `observeDeep` event paths and route to per-block/per-slot observer sets.
  - [x] Blanket `doc.subscribe()` kept for backward compat (still fires on all changes).
  - [x] 4 granularity tests: useBlock isolation, useSlotChildren isolation, useRootBlockIds isolation, useRootProps isolation (15 total hook tests).

- [~] **5.1 Remove compat bridge materialization**

  - [x] `selectedItem` now derived from Y.Doc (`blockToComponentData`) — no longer depends on materialized `state.indexes.nodes`
  - [x] `getCurrentData()` root path reads from Y.Doc `getRootPropsJSON()` — no longer depends on `state.data.root`
  - [x] `resolveComponentData` parent data from Y.Doc `blockToFullComponentData()` — no longer depends on `state.indexes.nodes`
  - [x] `FieldsSlice` fully migrated to Y.Doc reads + subscriptions — no longer depends on `state.indexes.nodes`
  - [~] `commitDocToStore` still calls `materializeAppState` — needed for: `onAction`/`onChange` callbacks (user API expects `AppState`), store slices (fields, permissions), `usePuck().appState`, Preview renderData
  - [ ] Make materialization lazy in `commitDocToStore` — only compute full state when `onAction` or `onChange` is registered
  - [ ] Remove `packages/core/crdt/compat.ts` — deferred until all `materializeAppState` callers are migrated

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

| Component                                          | Status                               |
| -------------------------------------------------- | ------------------------------------ |
| `diffPuckData` (walkTree-based diff)               | Eliminated                           |
| `PageOperation` types                              | Eliminated                           |
| `applyToYDoc` (op -> Yjs translation)              | Eliminated                           |
| `ydocToPuckData` (Y.Doc -> PuckData serialization) | Eliminated                           |
| LIS algorithm for move detection                   | Eliminated                           |
| Round-trip lossless serialization testing          | Eliminated                           |
| onChange debouncing                                | Eliminated                           |
| Snapshot-based undo/redo                           | Replaced by Y.UndoManager            |
| Custom presence tracking                           | Replaced by Yjs Awareness            |
| `walkAppState` index computation                   | Replaced by flat Y.Doc + ParentIndex |
| `makeStatePublic` / `flattenData` / `flattenNode`  | Removed                              |
| Full `Data` cloning on every action                | Eliminated                           |
