# Actionpad Bullet Selection Design

## Goal

Make bullet selection easier and more useful in Actionpad by adding a shared contiguous
selection model that supports:

- Dragging across visible rows to select bullets and copy them as markdown.
- Keyboard range selection for moving, indenting, and outdenting multiple bullets at once.

The two workflows should share one selection foundation, while keeping pointer selection,
keyboard selection, clipboard behavior, and structural commands as separate interaction
surfaces.

## Context

Actionpad currently has a focused bullet editor, native textarea selection, and
single-bullet structural commands. It does not have outline-level multi-selection.

Relevant existing behavior:

- Visible rows come from the visible-tree model.
- Bullet focus is tracked through `focusedNodeId`.
- Single-bullet structural operations already exist for indent, outdent, sibling move,
  same-depth move, and drag reparent.
- Plain-text outline parsing already exists; selected-row markdown export should be the
  matching output path.
- The existing drag handle is dedicated to moving or reparenting bullets.

## Decisions

Selection for this phase is contiguous over visible rows only. Non-contiguous selection is
out of scope.

Copying selected bullets copies only the selected visible rows. Collapsed hidden
descendants are not copied unless they are visible and included in the selected range.

Structural commands operate on selected top-level roots. If both a parent and one of its
visible descendants are selected, the descendant is not treated as an independent command
target. Moving a selected parent still moves its real subtree because tree integrity
requires children to move with their parent.

Selection changes are transient UI state, not document content. They should not be
persisted and should not be undoable. Structural edits caused by a selection should be
undoable as one grouped operation.

## Selection Model

Add a small outline-level selection model:

```ts
type BulletSelection = {
  anchorId: BulletId
  focusId: BulletId
}
```

Selected IDs are derived from `anchorId`, `focusId`, and the current visible row order.
The derived selected set should not be stored separately unless needed as a memoized view.

Range derivation should live near the visible-tree utilities so all callers use the same
row order and visibility rules. It should handle:

- Anchor before focus.
- Focus before anchor.
- Missing IDs.
- Collapsed descendants.
- Root and nested rows.

If selected IDs disappear after delete, paste, import, runtime patches, or collapse, the
selection should be trimmed to valid visible rows when possible or cleared when the range
can no longer be represented.

## Copy And Markdown Export

When a bullet selection exists, `Cmd+C` copies the selected visible rows as markdown.

Export rules:

- Preserve visible row order.
- Emit markdown bullets using `- `.
- Normalize indentation relative to the shallowest selected visible row.
- Include only selected visible rows.
- Preserve bullet text as written.

If no bullet selection exists, `Cmd+C` keeps the native textarea or browser copy behavior.

## Keyboard Behavior

Existing single-bullet shortcuts continue to work when no bullet range is selected.

When a contiguous bullet range is selected:

- `Tab` indents selected top-level roots.
- `Shift+Tab` outdents selected top-level roots.
- `Alt+ArrowUp` and `Alt+ArrowDown` move selected top-level roots.
- `Cmd+Shift+ArrowUp` and `Cmd+Shift+ArrowDown` move selected top-level roots across
  parent sibling boundaries at the same depth.

`Shift+ArrowUp` and `Shift+ArrowDown` extend bullet selection only when the focused
textarea is at its first or last line boundary with no text selection. Normal
`Shift+Arrow` inside bullet text remains native text selection.

Clicking a bullet clears the range. `Shift+Click` extends the contiguous range from the
current anchor. `Escape` clears the range.

## Pointer Drag Behavior

Dragging from the row gutter or row background starts bullet range selection. Dragging
inside editable text keeps native text selection.

The existing drag handle remains dedicated to moving or reparenting bullets. It should not
start range selection.

As the pointer crosses visible rows, the selected range updates from the anchor row to the
current row. Drag selection should support normal scroll behavior; auto-scroll near the
viewport edge is useful but can be treated as a follow-up if it makes the first
implementation too large.

## Architecture

Keep the implementation split across small units:

- Visible-row selection utilities for range derivation, selected-root normalization, and
  invalid-selection cleanup.
- Markdown export utilities for selected visible rows.
- Reducer/store actions for setting, extending, and clearing selection.
- Batch tree operation helpers that apply existing structural operations to selected roots
  as a single undoable edit.
- Outline-level event handling for pointer drag, copy, escape, and shift-click.
- Row-level rendering that receives selected/range-edge state and emits row interaction
  events.

`BulletRow` should stay focused on row rendering and row-local input handling. It should
not own range derivation or clipboard serialization.

## Error Handling

Selection should fail closed:

- If either selection endpoint is missing from the visible rows, clear or trim the range.
- If a batch command has no valid selected roots, leave state unchanged.
- If only some selected roots can perform a command, apply the command to the valid roots
  and leave invalid roots unchanged.
- If the user starts editing text, native text editing should win over bullet selection.

## Testing

Add focused domain tests for:

- Visible range derivation in both directions.
- Selected-root normalization when parent and child are both selected.
- Markdown serialization with relative indentation.
- Hidden collapsed descendants being omitted from copy.
- Invalid selection cleanup.

Add component tests for:

- `Shift+ArrowUp/Down` range selection at textarea line boundaries.
- Native textarea `Shift+Arrow` selection inside bullet text.
- `Shift+Click` range extension.
- Pointer drag-to-select from row gutter or row background.
- Existing drag-handle reparenting still working.
- `Cmd+C` copying selected visible rows as markdown.
- `Escape` clearing the range.
- Batch `Tab`, `Shift+Tab`, `Alt+Arrow`, and `Cmd+Shift+Arrow` behavior.

Regression tests should verify that existing single-bullet shortcuts and normal copy
behavior still work when no bullet range is selected.

## Non-Goals

- Non-contiguous selection.
- Copying hidden collapsed descendants.
- Persisting selection in saved documents.
- Adding a visible toolbar or new visual selection UI beyond selected-row styling.
- Changing the existing drag-handle reparent behavior.
