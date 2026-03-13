# Puck Demo (Yjs + Convex)

Demo application for the Puck visual editor with real-time collaborative editing via Yjs CRDTs and Convex sync.

## Modes

The demo runs in two modes depending on whether Convex is configured:

| | No Convex | With Convex |
|---|---|---|
| **Persistence** | localStorage | Convex database |
| **Sync** | Single user | Real-time multi-user |
| **Presence** | None | Colored block borders + header avatars |
| **Undo** | Local only | Per-user (doesn't affect other users) |
| **Publish** | Saves to localStorage | Sets page status in Convex |

## Setup

### Without Convex (localStorage fallback)

```sh
pnpm install
pnpm dev
```

Navigate to `http://localhost:3000/edit` to open the editor. Data persists in localStorage.

### With Convex (real-time sync)

```sh
pnpm install
cd apps/demo
npx convex dev        # creates project + generates types
```

Copy the deployment URL printed by `npx convex dev` and create `.env.local`:

```
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
```

Then start the app:

```sh
pnpm dev
```

Open two browser tabs to the same `/edit` URL to see real-time sync and presence.

## File structure

```
convex/
  schema.ts            ← pages + presence tables
  pages.ts             ← syncUpdate, getYjsState, create, publish, getPublished, list
  presence.ts          ← update, remove, getForPage
  compact.ts           ← nightly Y.Doc compaction cron
  crons.ts             ← cron schedule

lib/
  convex-yjs-provider.ts   ← ConvexYjsProvider class (Y.Doc ↔ Convex sync)
  convex-client-provider.tsx ← ConvexProvider wrapper (no-op when URL not set)
  use-convex-page.ts       ← useConvexPage hook (page lookup, Y.Doc init, provider lifecycle)
  use-presence.ts          ← usePresence hook (heartbeat, selection sync)
  presence-overlay.tsx     ← PresenceOverlay + PresenceAvatars UI components
  use-demo-data.ts         ← localStorage data hook (fallback mode)

app/[...puckPath]/
  page.tsx             ← Next.js page (server component)
  client.tsx           ← Client component (routes to Convex or localStorage mode)
  convex-editor.tsx    ← Convex-synced Puck editor with presence
  convex-render.tsx    ← Storefront render from Convex (no Yjs at read time)

config/
  index.tsx            ← Puck component config
  blocks/              ← Component definitions
  initial-data.ts      ← Default page data
```

## How it works

### Editor (edit mode)

1. `useConvexPage` looks up or creates the page in Convex
2. Y.Doc is initialized from the stored `yjsState`
3. `ConvexYjsProvider` starts syncing: local Y.Doc updates go to Convex, remote updates come back via reactive query
4. `<Puck>` renders with data from `pageDocument.toPuckData()`
5. All edits flow through Y.Doc — Convex sync is automatic
6. "Publish" calls the `publish` mutation (sets status to 'published')

### Presence

1. `usePresence` sends heartbeats every 10s to `presence.update`
2. `PresenceSync` (inside `<Puck>`) sends the selected block ID on change
3. `PresenceOverlay` renders colored borders on blocks edited by others
4. `PresenceAvatars` shows user dots in the header
5. Stale entries (>30s) are filtered out on read

### Render (view mode)

1. `ConvexRender` queries `getPublished` for materialized content
2. Reconstructs Puck Data from Y.Doc state
3. Renders via `<Render>` — no editor UI, no Yjs sync

## License

MIT
