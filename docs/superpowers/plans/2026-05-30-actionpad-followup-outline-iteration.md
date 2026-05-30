# Actionpad Follow-Up Outline Iteration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Codex runs produce nested/edit/delete outline patches and let chat follow-ups run against existing bullet threads.

**Architecture:** Extend the existing runtime protocol rather than adding a new harness. Keep document state in the React reducer, use the runtime as the execution bridge, and apply provider output through pure tree operations where practical.

**Tech Stack:** React, TypeScript, Vite, Vitest, local Node runtime, `@openai/codex-sdk`.

---

### Task 1: Outline Patch Model

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/runtimeProtocol.ts`
- Modify: `src/domain/treeOps.ts`
- Modify: `runtime/outlineOutput.ts`
- Modify: relevant domain/runtime tests

- [ ] Add nested bullet drafts with optional `children`.
- [ ] Add reducer/domain support for append nested children, update text, and delete node patches.
- [ ] Keep generated metadata on provider-created bullets.
- [ ] Validate patch shapes at the runtime boundary.

### Task 2: Run And Chat Flow

**Files:**
- Modify: `src/domain/fixtures.ts`
- Modify: `src/store/OutlineStore.tsx`
- Modify: `src/store/outlineReducer.ts`
- Modify: `src/runtimeClient/runtimeClient.ts`
- Modify: `src/components/ChatInput.tsx`
- Modify: relevant component/store tests

- [ ] Seed one empty bullet.
- [ ] Change first `Cmd+Enter` to start a run without opening the panel.
- [ ] Keep second `Cmd+Enter` on an existing thread as open/focus chat.
- [ ] Add active chat submission that starts a new same-thread run with the latest outline snapshot.
- [ ] Render runtime startup failure in the panel only when the panel is opened.

### Task 3: Runtime Follow-Up And Instructions

**Files:**
- Modify: `runtime/provider.ts`
- Modify: `runtime/server.ts`
- Modify: `runtime/codexProvider.ts`
- Modify: `runtime/fakeProvider.ts`
- Modify: runtime tests
- Modify: `docs/actionpad-runtime.md`

- [ ] Add a runtime message endpoint that providers expose as `sendMessage`.
- [ ] Implement Codex follow-up messages by resuming the provider thread when available, or continuing with the current prompt format when only the app thread id exists.
- [ ] Update Codex instructions to request concise bullets, useful sub-bullets, and patch-based edits/deletes.
- [ ] Keep fake provider deterministic for manual testing.

### Task 4: Focused Verification And Commit

- [ ] Run focused Vitest files for protocol, tree/reducer, side panel, and runtime server/provider behavior.
- [ ] Run `npm run build`.
- [ ] Do one P0-only self-review. Fix only issues that block running, corrupt data, or prevent the requested behavior.
- [ ] Note non-P0 follow-ups in `docs/superpowers/known-issues/2026-05-30-actionpad-followup-outline-iteration-followups.md`.
- [ ] Commit the finished implementation.
