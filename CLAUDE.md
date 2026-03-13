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

### State Management (`packages/core/store/`)
- Zustand store with `subscribeWithSelector` middleware
- `AppStore` type holds state, config, dispatch, and slice modules
- `dispatch(action)` runs through Redux-style reducer, then syncs state to Y.Doc
- `commitDocToStore(appStoreApi, options?)` — materializes Y.Doc → Zustand state after direct PageDocument mutations. Used by callers that bypass dispatch.
- Slices: `nodes`, `permissions`, `fields`
- History: `HistorySlice` (thin wrapper around Y.UndoManager — `back`, `forward`, `hasPast`, `hasFuture`)

### Reducer (`packages/core/reducer/`)
- `createReducer` wraps action handlers in `storeInterceptor` (fires onAction callback only)
- Actions: insert, remove, move, reorder, replace, replaceRoot, duplicate, set, setData, setUi, registerZone, unregisterZone
- Each action handler receives `(state, action, appStore)` and returns new `PrivateAppState`

### CRDT Layer (`packages/core/crdt/`)
- Active migration: 5 reducer actions (insert, remove, move, duplicate, reorder) are PageDocument-first. All `replace`/`replaceRoot` callers are migrated to `doc.updateProps` + `commitDocToStore` — they no longer go through dispatch
- History (undo/redo) uses Y.UndoManager, not snapshot arrays
- Migration plan & task tracker: `TODO.md` (phases), `plans/puck-fork-architecture.md` (design rationale)
- Dispatch pre-syncs Y.Doc for all actions (handles external `setState` calls). Post-sync only runs for `set`/`setData`/`replace`/`replaceRoot`
- `PageDocument.ts` — Y.Doc wrapper: addBlock, removeBlock, moveBlock, duplicateBlock, updateProp, updateProps, updateRootProps, undo/redo
- `context.tsx` — `PageDocumentProvider` / `usePageDocument` — React context for Y.Doc access (wired into Puck component tree)
- `hooks.ts` — `useBlock`, `useRootBlockIds`, `useRootProps`, `useSlotChildren` — reactive Y.Doc hooks (NOTE: fire on ALL doc changes, not per-block — not yet suitable for surgical re-renders)
- `compat.ts` — `materializeAppState(doc, ui, config)`: Y.Doc → Puck state bridge (toPuckData + walkAppState)
- `sync.ts` — `syncDocFromState(doc, data, config)`: Puck state → Y.Doc (clear-and-rebuild)
- `dispatch.ts` — Helpers: `parseZoneCompound`, `getBlockIdAtIndex`, `buildSlotDefs`

### Key Types
- `PrivateAppState` = `{ data, ui, indexes: { nodes: NodeIndex, zones: ZoneIndex } }`
- `Data` = `{ root, content, zones }`
- Zone compound format: `"parentId:slotName"` (e.g., `"root:default-zone"`)
- `rootAreaId = "root"`, `rootZone = "default-zone"`

## Testing

- Jest with `ts-jest/presets/js-with-ts-esm`, jsdom environment
- ESM packages (`yjs`, `y-protocols`, `lib0`, `@preact/signals-*`, `@dnd-kit`) must be in `transformIgnorePatterns` exceptions in `jest.config.ts`
- Snapshot tests in `components/Puck/__tests__/` — update after AppStore shape changes

## Gotchas

- Action migration pattern: sync doc → PageDocument method → `materializeAppState`. See CRDT Layer section above for which actions are migrated.
- `initialHistory` prop and legacy history API (`setHistories`, `setHistoryIndex`, `record`) have been removed — Y.UndoManager is the only history mechanism
- `walkAppState` rebuilds `NodeIndex` and `ZoneIndex` from data — expensive, used after state changes
- Slot fields (type: "slot") store child content inline on props; legacy DropZones use `data.zones`
- Y.UndoManager `captureTimeout: 500ms` merges rapid actions into single undo steps
- When calling `doc.updateProps`, filter out slot-type fields — slots are stored as separate Y.Array structures in Y.Doc, not as nested props. Use config to check `field.type === "slot"`
- `resolveAndReplaceData`, `resolveDataById`, `resolveDataBySelector` accept `AppStoreApi` (not `getState`) as second argument
- Tests that call `appStore.setState(...)` directly don't sync the Y.Doc — dispatch pre-sync handles this, but direct `pageDocument` reads may see stale data
- `syncDocFromState` does full clear-and-rebuild — used as pre-sync before all dispatches and post-sync for `set`/`setData`/`replace`/`replaceRoot` only. Also used in `resolveAndCommitData` (one-time load)
