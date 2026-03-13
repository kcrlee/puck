# Puck Editor

Puck is a visual page editor for React. This is a fork adding Yjs CRDT-based state management.

## Repository Structure

Monorepo managed by Turborepo with Yarn 1.x.

- `packages/core` — Main editor package (components, state, reducer, CRDT layer)
- `packages/plugin-*` — Editor plugins
- `apps/demo` — Demo application

## Common Commands

- `yarn install` — Required before running tests (npx jest fails without local node_modules)
- `yarn build` — Build all packages (turbo)
- `yarn dev` — Dev server for demo app
- `yarn test` — Run all tests (turbo)
- `npx jest --config packages/core/jest.config.ts` — Run core package tests directly (faster iteration)
- `npx jest --config packages/core/jest.config.ts -- path/to/test.spec.ts` — Run a single test file
- `npx jest -u --config packages/core/jest.config.ts` — Update snapshots after AppStore type changes
- `yarn lint` — Lint all packages
- `yarn format` — Format with Prettier

## Code Style

- TypeScript strict mode in core
- Functional React components, no class components
- Zustand for state; no Redux or useReducer in components
- Prefer `Edit` tool over creating new files — this is a mature codebase

## Core Architecture

### Y.Doc — Source of Truth (`packages/core/crdt/`)

**Y.Doc is the sole source of truth for all data.** No production code reads `state.data` or `state.indexes`.

- `PageDocument.ts` — Y.Doc wrapper: addBlock, removeBlock, moveBlock, duplicateBlock, updateProps, updateRootProps, undo/redo
- `toPuckDataCached()` — cached `toPuckData()` with `_dataVersion` counter, invalidated on Y.Doc changes
- `blockToComponentData(doc, id)` / `blockToFullComponentData(doc, id, config)` in `crdt/block-data.ts` — build ComponentData from Y.Doc block (used for `selectedItem`, permissions, drag preview, item lookups)
- `hooks.ts` — `useBlock`, `useRootBlockIds`, `useRootProps`, `useSlotChildren` — per-block granular Y.Doc hooks via `subscribeBlock`/`subscribeSlot`/`subscribeRootBlocks`/`subscribeRootProps`
- `context.tsx` — `PageDocumentProvider` / `usePageDocument` — React context for Y.Doc access
- `sync.ts` — `syncDocFromState(doc, data, config)`: Puck Data → Y.Doc (clear-and-rebuild). Used inside `set`/`setData` action handlers and test helpers.
- `dispatch.ts` — Helpers: `parseZoneCompound`, `getBlockIdAtIndex`, `buildSlotDefs`, `addBlockToDoc`
- `get-selector-for-id.ts` — `getSelectorForId(doc, id)` and `getPositionForId(doc, id)` take `PageDocument`

### State Management (`packages/core/store/`)
- Zustand store with `subscribeWithSelector` middleware
- `AppStore` type holds state, config, dispatch, pageDocument, and slice modules
- `state.data` exists but is Y.Doc-derived — only written for `onAction` callback compat
- `state.indexes` is always `{ nodes: {}, zones: {} }` — vestigial, never read
- `dispatch(action)` runs reducer. No pre-sync or post-sync — Y.Doc is authoritative.
- `commitDocToStore(appStoreApi, options?)` — updates UI state + selectedItem after direct PageDocument mutations. Only materializes `state.data` when `onAction` callback needs it.
- `onChange` subscribes to Y.Doc changes directly (not `state.data`), calls `toPuckDataCached()`
- `usePuck().appState.data` reads from `toPuckDataCached()` (not `state.data`)
- Slices: `nodes` (DOM refs), `permissions`, `fields`
- History: `HistorySlice` (thin wrapper around Y.UndoManager — `back`, `forward`, `hasPast`, `hasFuture`)

### Reducer (`packages/core/reducer/`)
- `createReducer` returns a plain reducer function — `onAction` fired from dispatch/commitDocToStore
- **Y.Doc-first**: insert, remove, move, reorder, duplicate — write to Y.Doc, materialize `state.data` only when `onAction` is set
- **Y.Doc-synced**: set, setData — merge against `toPuckDataCached()`, sync to Y.Doc via `syncDocFromState`
- **Y.Doc-direct**: replace, replaceRoot — use `doc.updateProps`/`doc.updateRootProps` (no `walkAppState`)
- **No-op**: registerZone, unregisterZone — Y.Doc persists zone data regardless of mount state
- **UI-only**: setUi
- Components (DraggableComponent, DragDropContext, Fields, InlineTextField) bypass dispatch for data mutations — use `doc.method()` + `commitDocToStore(appStore, { onAction, ui })`

### Key Types
- `PrivateAppState` = `{ data, ui, indexes }` — only `ui` is independently maintained; `data` is Y.Doc-derived, `indexes` is always empty
- `Data` = `{ root, content, zones }`
- Zone compound format: `"parentId:slotName"` (e.g., `"root:default-zone"`)
- `rootAreaId = "root"`, `rootZone = "default-zone"`

## Testing

- Jest with `ts-jest/presets/js-with-ts-esm`, jsdom environment
- ESM packages (`yjs`, `y-protocols`, `lib0`, `@preact/signals-*`, `@dnd-kit`) must be in `transformIgnorePatterns` exceptions in `jest.config.ts`
- Snapshot tests in `components/Puck/__tests__/` — update after AppStore shape changes
- Test helper `ensureIndexes` rebuilds indexes via `walkAppState` for assertion compat
- Set `onAction: () => {}` on test stores if materialized `state.data` assertions are needed (migrated actions skip materialization without it)

## Gotchas

- `insertComponent` and `moveComponent` (in `lib/`) bypass dispatch — they write to Y.Doc directly and call `commitDocToStore`
- When calling `doc.updateProps`, filter out slot-type fields — slots are stored as separate Y.Array structures in Y.Doc, not as nested props. Use config to check `field.type === "slot"`
- Tests that call `appStore.setState(...)` directly MUST call `syncDocFromState()` afterward — there is no automatic pre-sync. Y.Doc is authoritative.
- `syncDocFromState` clear-and-rebuild fires ALL Y.Doc observers, even for unchanged blocks. Imperative subscriptions need deduplication: use `queueMicrotask` + JSON snapshot comparison. See `store/slices/fields.ts` and `store/slices/permissions.ts`.
- `selectedItem` is derived from Y.Doc via `blockToComponentData()` — no slot children inline. Use `blockToFullComponentData()` for nested slot data.
- `doc.findParent(id)` returns `null` for root-level blocks. Use `doc.getLocation(id)` for the raw parent index entry, then provide synthetic root parent `{ type: "root", props: { ...rootProps, id: "root" } }`.
- `resolveAndReplaceData`, `resolveDataById`, `resolveDataBySelector` accept `AppStoreApi` (not `getState`) as second argument
- `walkAppState` is expensive — only used in `migrate.ts` (one-time) and test helpers. Not on any production hot path.
- Y.UndoManager `captureTimeout: 500ms` merges rapid actions into single undo steps
- Migration plan & task tracker: `TODO.md` (phases), `plans/puck-fork-architecture.md` (design rationale)
