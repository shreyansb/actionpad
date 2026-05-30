# Actionpad Follow-Up Outline Iteration Design

## Goal

Make executable bullets feel less modal and more document-native. Running a new bullet should happen quietly in the outline, while existing bullet chats should support follow-up messages that can add, edit, or remove document bullets.

## Scope

- Start the document with one empty root bullet.
- Do not add SQLite or durable document persistence in this pass.
- Pressing `Cmd+Enter` on a bullet with no chat starts a run in the background and shows the existing row spinner.
- Pressing `Cmd+Enter` on a bullet with an existing chat opens the side panel and focuses the chat input.
- Chat input is editable. Submitting a follow-up starts a new run on the existing thread using the current outline snapshot.
- Codex instructions should ask for concise outline output: only a few bullets, with sub-bullets when useful.
- Codex can emit outline patches that append nested bullets, edit bullet text, and delete bullets it previously added.

## Design

The browser remains the editor and viewer. It sends the current outline snapshot and a prompt to the local runtime for both initial bullet execution and follow-up chat messages. Follow-ups reuse the existing Actionpad thread id so the UI can keep the same side-panel conversation.

The outline patch format gains nested bullet drafts and explicit edit/delete operations. The reducer applies these patches through domain tree operations and records them on the thread timeline. Runtime validation rejects malformed patches before the browser sees them.

Persistence remains in-memory React state. Durable storage is intentionally deferred to a SQLite document model in a later phase.

## Verification

Focused tests should cover nested append, edit/delete patches, initial empty state, quiet first run behavior, and follow-up chat submission. A build/typecheck pass should catch runtime protocol drift.
