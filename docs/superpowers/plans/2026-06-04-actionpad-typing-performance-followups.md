# Actionpad Typing Performance Follow-Ups

These are non-blocking follow-ups found during implementation review. They are intentionally parked so the main performance plan can move quickly.

- Add an immutability assertion to the reducer identity test that confirms the original edited node text remains unchanged after `update-text`.
- Add direct regression coverage for `syncTerminalRunIntoUndoStack` with a mixed undo stack containing both text-edit and snapshot entries.
- Add direct regression coverage for undoing a legacy raw `OutlineUndoSnapshot` entry from a persisted undo stack.
