# Puck + Yjs CRDT Fork

> **This is a fork of [Puck](https://github.com/puckeditor/puck)** that replaces the immutable snapshot state layer with [Yjs](https://yjs.dev/) CRDTs, enabling real-time collaborative editing. Includes a [Convex](https://convex.dev/) sync provider for persistence and multi-user sync.

## What changed from upstream Puck

The `<Puck>` component API is unchanged — `config`, `data`, `onPublish`, `onChange`, and `overrides` all work exactly as before. Under the hood:

- **Y.Doc is the sole source of truth** for page data. All reads go through Y.Doc, not `state.data`.
- **Every edit is a CRDT operation** (insert, move, delete, prop update), so concurrent edits merge automatically.
- **Undo/redo uses Y.UndoManager** instead of snapshot arrays. Undoing your changes doesn't undo other users' concurrent edits.
- **Per-block granular reactivity** — editing one block doesn't re-render siblings.

No changes are needed in your component configs or render code.

## Quick start

### Install from this repo

This fork isn't published to npm. Install it by pointing your package manager at the local build output.

```sh
# 1. Clone and build
git clone <this-repo-url> puck
cd puck
pnpm install
pnpm build

# 2. In your project, add a dependency on the local package
# Option A: pnpm link
cd packages/core && pnpm link --global
cd /path/to/your/project && pnpm link --global @puckeditor/core

# Option B: file: protocol in package.json
# In your project's package.json:
#   "dependencies": {
#     "@puckeditor/core": "file:/path/to/puck/packages/core"
#   }

# Option C: pnpm workspace (if puck is a sibling in a monorepo)
# In your pnpm-workspace.yaml, add the path to puck/packages/core
```

After any change to the core package, rebuild with `pnpm build` (or `cd packages/core && pnpm build` for just core). The `dist/` output is what consumers import.

### Single-user (no sync)

Works exactly like upstream Puck. No Convex or Yjs knowledge needed.

```jsx
import { Puck, Render } from "@puckeditor/core";
import "@puckeditor/core/puck.css";

const config = {
  components: {
    Heading: {
      fields: { text: { type: "text" } },
      render: ({ text }) => <h1>{text}</h1>,
    },
  },
};

// Editor
<Puck config={config} data={{}} onPublish={(data) => save(data)} />

// Render
<Render config={config} data={savedData} />
```

The CRDT layer runs internally. `onChange` and `onPublish` still emit standard Puck `Data` objects — serialize them however you like.

### Multi-user with Convex

The `apps/demo` directory includes a full Convex integration with real-time sync, presence indicators, and a publish flow.

#### 1. Install dependencies

```sh
pnpm install
```

#### 2. Set up Convex

```sh
cd apps/demo
npx convex dev
```

This creates a Convex project, generates types in `convex/_generated/`, and prints your deployment URL.

#### 3. Configure environment

Create `apps/demo/.env.local`:

```
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
```

#### 4. Run the demo

```sh
pnpm dev
```

Open two browser tabs to the same page's `/edit` URL. Edits sync in real-time. You'll see:
- Colored borders on blocks being edited by other users
- Avatar dots in the header showing active editors
- Independent undo/redo per user

When `NEXT_PUBLIC_CONVEX_URL` is not set, the demo falls back to localStorage (single-user, no sync).

## Architecture

```
@puckeditor/core
  packages/core/crdt/
    PageDocument.ts    ← Y.Doc wrapper (addBlock, moveBlock, updateProps, undo/redo)
    hooks.ts           ← useBlock, useSlotChildren, useRootProps (granular Y.Doc subscriptions)
    sync.ts            ← syncDocFromState (Puck Data → Y.Doc, used by set/setData actions)
    block-data.ts      ← blockToComponentData (Y.Doc → ComponentData)
    context.tsx         ← PageDocumentProvider (React context)

apps/demo/convex/
    schema.ts          ← pages + presence tables
    pages.ts           ← syncUpdate, getYjsState, create, publish, getPublished
    presence.ts        ← update, remove, getForPage
    compact.ts         ← nightly Y.Doc compaction (>5MB)

apps/demo/lib/
    convex-yjs-provider.ts   ← ConvexYjsProvider (Y.Doc ↔ Convex sync)
    use-convex-page.ts       ← useConvexPage hook (lifecycle management)
    use-presence.ts          ← usePresence hook (heartbeat + selection sync)
    presence-overlay.tsx     ← PresenceOverlay + PresenceAvatars components
```

### How sync works

1. User edits a block → `doc.updateProps()` mutates the local Y.Doc
2. Y.Doc emits an `update` event with a binary delta
3. `ConvexYjsProvider` sends the delta to Convex via `syncUpdate` mutation
4. Convex merges the delta with stored state using `Y.mergeUpdates`
5. Other clients receive the merged state via reactive `getYjsState` query
6. Remote updates are applied with origin `'remote'` so Y.UndoManager ignores them

### How presence works

1. `usePresence` sends a heartbeat to Convex every 10 seconds
2. On selection change, `PresenceSync` sends the selected block ID
3. `getForPage` query returns all active users (TTL 30s), filtering stale entries
4. `PresenceOverlay` renders colored borders on blocks edited by others
5. `PresenceAvatars` renders user dots in the editor header

## Development

```sh
pnpm install          # install all dependencies
pnpm build            # build all packages
pnpm dev              # start demo app dev server
pnpm test             # run all tests
pnpm lint             # lint all packages
```

Run core package tests directly (faster iteration):

```sh
npx jest --config packages/core/jest.config.ts
```

## Repository structure

| Path | Description |
|------|-------------|
| `packages/core` | Main editor package (components, state, reducer, CRDT layer) |
| `packages/plugin-*` | Editor plugins |
| `apps/demo` | Demo app with Convex sync |
| `plans/puck-fork-architecture.md` | Design rationale for the CRDT migration |
| `TODO.md` | Phase-by-phase task tracker |

## License

MIT
