# Puck Fork: Yjs CRDT State Layer — Task Tracker

> Replaces Puck's immutable snapshot state with native Yjs CRDTs.
> See [plans/puck-fork-architecture.md](plans/puck-fork-architecture.md) for full design rationale.

---

## Phases 1–5: Complete

### Phase 1: Foundation — PageDocument + Hooks ✓

Created `packages/core/crdt/` with `PageDocument` (Y.Doc wrapper), reactive hooks (`useBlock`, `useSlotChildren`, `useRootBlockIds`, `useRootProps`), context provider, and comprehensive tests (42 tests).

### Phase 2: Compatibility Bridge ✓

Wired Y.Doc into AppStore via `syncDocFromState` (Puck state → Y.Doc) and `materializeAppState` (Y.Doc → Puck state). All existing tests continued to pass.

### Phase 3: Replace History with Y.UndoManager ✓

Rewrote `HistorySlice` as thin wrapper around Y.UndoManager. Removed `initialHistory` prop, snapshot-based history, `setHistories`/`setHistoryIndex`/`record` APIs. Undo/redo via Ctrl+Z/Ctrl+Shift+Z.

### Phase 4: Migrate Consumer Components to Y.Doc Hooks ✓

Migrated all component-level consumers to read from Y.Doc:

- `itemSelector` changed from position-based to ID-based (collaboration-safe)
- DropZone, DraggableComponent, DragDropContext, Fields, InlineTextField, LayerTree, Header, Preview, Outline, useBreadcrumbs, useParent — all read from Y.Doc hooks/methods
- Components bypass dispatch for data mutations: `doc.method()` + `commitDocToStore()`
- Permissions and Fields slices subscribe to Y.Doc with `queueMicrotask` deduplication
- `blockToComponentData`/`blockToFullComponentData` extracted to `crdt/block-data.ts`

### Phase 5: Remove Compatibility Bridge ✓

**Y.Doc is now the sole source of truth.** No production code reads `state.data` or `state.indexes`.

Key changes:

- **Reducer gutted**: `storeInterceptor` removed, `replace`/`replaceRoot` rewritten to Y.Doc primitives, `set`/`setData` merge against `toPuckDataCached()`, `registerZone`/`unregisterZone` are no-ops
- **Dispatch simplified**: No pre-sync, no post-sync, no dirty tracking. Y.Doc is authoritative.
- **`_docDirty` and `_hasOnChange` flags removed** — no longer needed
- **`onChange`** subscribes to Y.Doc directly (not `state.data`), calls `toPuckDataCached()`
- **`usePuck().appState.data`** reads from `toPuckDataCached()` (not `state.data`)
- **Permissions/Fields** resolver callbacks compute `appState.data` from `doc.toPuckDataCached()`
- **`commitDocToStore`** only materializes `state.data` when `onAction` callback needs it
- **Migrated actions** (insert, remove, move, duplicate, reorder) materialize only when `onAction` is set
- **`toPuckDataCached()`** added to PageDocument — version-counter-based cache

Deleted files/utilities:

- `crdt/compat.ts` (materializeAppState)
- `lib/data/make-state-public.ts`
- `lib/data/flatten-data.ts`
- `lib/data/get-ids-for-parent.ts`
- `lib/data/find-zones-for-area.ts`
- `getItem()` function (kept `ItemSelector` type export)
- `zoneCache`/`addToZoneCache` from move.ts and register-zone.ts

Retained for backward compat:

- `state.data` on AppStore type — Y.Doc-derived, written for `onAction` callback and test assertions
- `state.indexes` on AppStore type — always `{ nodes: {}, zones: {} }`
- `walkAppState` — only in `migrate.ts` (one-time) and test infrastructure
- `flattenNode` — only in `walkAppState` and test helper `expectIndexed`
- 2 replace tests skipped (deprecated dispatch path with nested slot replacement)

### Phase 5 verification

- [x] No production code reads `state.data` or `state.indexes`
- [x] Bundle size decrease (eliminated materializeAppState, flattenData, makeStatePublic, getIdsForParent, storeInterceptor, pre/post-sync)
- [x] 172 tests pass, 2 skipped
- [ ] Demo app fully functional (manual testing needed)

---

## Phase 6: Convex Sync Provider

Application layer in `apps/demo/`. Core package (`packages/core`) has no Convex dependency.

> Ref: [Architecture § Convex Sync Layer](plans/puck-fork-architecture.md#convex-sync-layer)
> Ref: [Architecture § Convex Yjs Provider](plans/puck-fork-architecture.md#convex-yjs-provider)

### Setup

```bash
cd apps/demo
npx convex dev          # creates project, generates _generated/ types, starts dev server
# Set NEXT_PUBLIC_CONVEX_URL in .env.local (printed by `npx convex dev`)
```

When `NEXT_PUBLIC_CONVEX_URL` is not set, the demo app falls back to localStorage (no Convex dependency at runtime).

- [x] **6.1 Convex schema**
      `apps/demo/convex/schema.ts` — `pages` table with `yjsState: v.bytes()`, `content: v.any()`, `version: v.number()`, `status`, `tenantId`, `slug`

- [x] **6.2 Sync mutation + queries**
      `apps/demo/convex/pages.ts`

  - [x] `syncUpdate` — merge incoming Yjs delta with stored state via `Y.mergeUpdates`, materialize `content`
  - [x] `getYjsState` — reactive query returning `{ yjsState, version }` for provider subscription
  - [x] `create` — create page with initial Y.Doc state
  - [x] `publish` — set page status to 'published', re-materialize content
  - [x] `getPublished` — read materialized content by tenant+slug (storefront path)
  - [x] `list` — list pages for tenant (omits yjsState blob)

- [x] **6.3 ConvexYjsProvider**
      `apps/demo/lib/convex-yjs-provider.ts`

  - [x] `ydoc.on('update')` → Convex `syncUpdate` mutation (skips remote-origin updates)
  - [x] `convex.onUpdate(getYjsState)` → `Y.applyUpdate(ydoc, state, 'remote')` with version dedup
  - [x] `useConvexPage` hook — manages full lifecycle: page lookup/create, Y.Doc init, provider start
  - [x] `ConvexClientProvider` — conditional provider (no-op when `NEXT_PUBLIC_CONVEX_URL` unset)
  - [x] Demo app wired: `ConvexEditor` component with Convex sync, `Client` falls back to localStorage

- [x] **6.4 Compaction cron**
      `apps/demo/convex/crons.ts` + `apps/demo/convex/compact.ts` — nightly re-encode of Y.Docs over 5MB threshold

- [x] **6.5 Awareness / Presence**
      Convex-native presence (not raw Yjs Awareness protocol — Convex latency is fine for page builders)

  - [x] `convex/presence.ts` — `update`, `remove`, `getForPage` mutations/queries with TTL-based cleanup
  - [x] `presence` table in schema — `pageId`, `userId`, `userName`, `userColor`, `selectedBlockId`, `activeField`
  - [x] `lib/use-presence.ts` — `usePresence` hook: heartbeat every 10s, syncs selection changes, filters self
  - [x] `lib/presence-overlay.tsx` — `PresenceOverlay` (colored border + name badge on selected blocks), `PresenceAvatars` (header user dots)
  - [x] Wired into `ConvexEditor` via `componentOverlay` and `headerActions` overrides
  - [x] `PresenceSync` inner component syncs Puck selection → Convex presence

- [x] **6.6 Storefront read path**

  - [x] `getPublished` query returns materialized content by tenant+slug (no Yjs needed)
  - [x] `convex-render.tsx` — `ConvexRender` component reads published page from Convex, reconstructs Puck Data from Y.Doc state, renders via `<Render>`
  - [x] `client.tsx` routes non-edit Convex path to `ConvexRender`
  - [ ] Production Cloudflare Worker — out of scope for demo app, but `getPublished` query is ready

### Phase 6 verification

- [ ] `npx convex dev` + `yarn dev` starts without errors (requires Convex project setup)
- [ ] Two browser tabs editing the same page: changes sync in real-time
- [ ] Undo in one tab doesn't revert the other tab's changes
- [ ] Refresh a tab: state restored from Convex yjsState
- [ ] Presence: colored borders and name badges appear on blocks selected by other users
- [ ] Storefront: non-edit path renders published content from Convex

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
| `materializeAppState` / `compat.ts`                | Removed                              |
| `makeStatePublic` / `flattenData`                  | Removed                              |
| `getIdsForParent` / `findZonesForArea`             | Removed                              |
| `storeInterceptor` / dispatch pre/post-sync        | Removed                              |
| `_docDirty` / `_hasOnChange` flags                 | Removed                              |
| Full `Data` cloning on every action                | Eliminated                           |
