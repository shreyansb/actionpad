# Actionpad `@` Mention Follow-Ups

Deferred during the V1 runtime-backed mention pass because they are not P0/P1 for the prototype:

- Mention insertion is plain text plus sidecar metadata. A richer token/chip model may be needed later for clearer deletion, selection, and duplicate-label handling.
- Undo for selecting a mention is not fully atomic: text insertion and metadata attachment are separate reducer actions. Active-run filtering prevents stale metadata from being sent, but the editor undo feel can be tightened later.
- Folder navigation inside the palette is intentionally simple. Entering a folder does not add a visible path breadcrumb yet.
- File previews assume UTF-8 text. Binary file detection and nicer truncation can come later.
- There is no permission UI beyond runtime read failures becoming warnings.
- Mentions are only implemented in bullet text, not chat input.
