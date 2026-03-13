# Puck Editor

Puck is a visual page editor for React. This is a fork adding Yjs CRDT-based state management.

## Repository Structure

Monorepo managed by Turborepo with Yarn 1.x.

- `packages/core` — Main editor package (components, state, reducer, CRDT layer)
- `packages/plugin-*` — Editor plugins
- `apps/demo` — Demo application

## Common Commands

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
- Slices: `history`, `nodes`, `permissions`, `fields`

### Reducer (`packages/core/reducer/`)
- `createReducer` wraps action handlers in `storeInterceptor` (handles onAction callback)
- Actions: insert, remove, move, reorder, replace, replaceRoot, duplicate, set, setData, setUi, registerZone, unregisterZone
- Each action handler receives `(state, action, appStore)` and returns new `PrivateAppState`

### CRDT Layer (`packages/core/crdt/`)
- Active migration: reducer is still authoritative, Y.Doc is synced mirror after dispatch
- History (undo/redo) uses Y.UndoManager, not snapshot arrays
- Migration plan: `.claude/plans/sorted-juggling-lightning.md`
- When modifying reducer actions or store: ensure `syncDocFromState` still works (it rebuilds Y.Doc after every dispatch)

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

- Active CRDT migration in progress — see plan at `.claude/plans/sorted-juggling-lightning.md`
- `walkAppState` rebuilds `NodeIndex` and `ZoneIndex` from data — expensive, used after state changes
- Slot fields (type: "slot") store child content inline on props; legacy DropZones use `data.zones`
- Y.UndoManager `captureTimeout: 500ms` merges rapid actions into single undo steps
- `syncDocFromState` does full clear-and-rebuild — coarse but correct for the sync bridge phase
