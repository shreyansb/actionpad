# Actionpad IndexedDB Persistence Design

## Goal

Add quick local-first persistence for the prototype without introducing SQLite or server-side document storage yet. Reloading the web app should restore the current Actionpad document, including bullets and chat history, while the editor continues to feel instant.

## Decision

Use browser IndexedDB as a snapshot store for the current document. This is a prototype stepping stone, not the final persistence architecture. The implementation should hide storage behind a small persistence boundary so a later runtime-owned SQLite implementation can replace or import it.

## Storage Model

Create one IndexedDB database:

- Database name: `actionpad`
- Object store: `documents`
- Key: document id

Persist one active document for now:

```ts
type PersistedDocument = {
  id: "default"
  schemaVersion: 1
  savedAt: number
  state: OutlineState
}
```

The saved `OutlineState` should include the same state the reducer currently owns: root ids, nodes, focused node, selected thread, panel state, threads, runs, and undo stack. This is intentionally simple. We can trim UI-only fields later if they become noisy.

## Client Flow

On app start:

1. Initialize the app with the normal empty document state.
2. Load the `default` document from IndexedDB.
3. If the saved document exists and has `schemaVersion: 1`, hydrate the reducer with its state.
4. If the saved document is missing, invalid, or unreadable, keep the fresh empty document.

On app changes:

1. Apply reducer changes immediately so typing, moving bullets, and runtime output stay snappy.
2. Debounce snapshot saves to IndexedDB, around 500 ms after state changes.
3. Save the full `PersistedDocument` snapshot.

Save failures should not block editing. For the prototype, logging failures to the console is enough.

## Runtime Relationship

The runtime remains responsible for agent execution only. IndexedDB persistence lives in the browser app and does not require the runtime process to be running. Runtime events continue to enter the reducer first; persistence observes the resulting state and snapshots it.

## Versioning And Rollback

This phase does not implement persisted event history or full version rollback. It keeps the existing in-memory undo behavior and stores the current undo stack as part of the snapshot.

To remain open to later rollback/version history:

- Include `schemaVersion` on persisted documents.
- Keep stable document and bullet ids.
- Keep persistence behind `loadDocument`, `saveDocument`, and `clearDocument` style functions.
- Do not entangle IndexedDB with reducer internals beyond serializing/deserializing `OutlineState`.

Later SQLite can import this snapshot once, then move toward normalized tables and append-only document events.

## Error Handling

- Unknown schema version: ignore saved state and use a fresh document.
- IndexedDB unavailable or blocked: use in-memory state for the session.
- Corrupt document shape: use a fresh document.
- Save failure: keep editing, log a warning.

## Non-Goals

- No SQLite in this phase.
- No multi-document picker.
- No sync, collaboration, or server persistence.
- No persisted event log.
- No UI for version browsing or rollback.

## Verification

- Unit test the persistence boundary with mocked IndexedDB behavior where practical.
- Component/store test that saved state hydrates the app.
- Component/store test that state changes trigger a debounced save.
- Manual browser smoke test: edit a bullet, reload, confirm the bullet and chat state persist.
