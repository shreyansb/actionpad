import { describe, expect, it, vi } from "vitest"
import { createInitialOutlineState } from "../domain/fixtures"
import type { AgentRun, AgentThread, OutlineUndoSnapshot } from "../domain/types"
import {
  createActionpadBackup,
  createIndexedDbDocumentPersistence,
  getPersistedDocumentFromBackup,
  isActionpadBackup,
  isPersistedDocument,
  type PersistedDocument,
} from "./documentPersistence"

describe("documentPersistence", () => {
  it("returns null and no-ops writes when IndexedDB is unavailable", async () => {
    const original = globalThis.indexedDB
    vi.stubGlobal("indexedDB", undefined)

    await expect(createIndexedDbDocumentPersistence().loadDocument()).resolves.toBeNull()
    await expect(
      createIndexedDbDocumentPersistence().saveDocument(createInitialOutlineState()),
    ).resolves.toBeUndefined()
    await expect(createIndexedDbDocumentPersistence().clearDocument()).resolves.toBeUndefined()

    vi.stubGlobal("indexedDB", original)
  })

  it("accepts schema version 1 persisted documents", () => {
    expect(
      isPersistedDocument({
        id: "default",
        schemaVersion: 1,
        savedAt: 100,
        state: createInitialOutlineState(),
      }),
    ).toBe(true)
  })

  it("rejects unsupported schema versions", () => {
    expect(
      isPersistedDocument({
        id: "default",
        schemaVersion: 999,
        savedAt: 100,
        state: createInitialOutlineState(),
      }),
    ).toBe(false)
  })

  it("rejects corrupt persisted document shape", () => {
    expect(
      isPersistedDocument({
        id: "default",
        schemaVersion: 1,
        savedAt: 100,
        state: { rootIds: "not-an-array", nodes: null, undoStack: [] },
      }),
    ).toBe(false)
  })

  it("creates a versioned JSON backup around the persisted document", () => {
    const persisted = {
      id: "default",
      schemaVersion: 1,
      savedAt: 100,
      state: createInitialOutlineState(),
    } as const

    const backup = createActionpadBackup(persisted, {
      exportedAt: 200,
      origin: "http://localhost:5175",
    })

    expect(backup).toMatchObject({
      exportVersion: 1,
      exportedAt: 200,
      origin: "http://localhost:5175",
      databases: [
        {
          name: "actionpad",
          version: 1,
          objectStores: [
            {
              name: "documents",
              keyPath: "id",
              records: [persisted],
            },
          ],
        },
      ],
    })
    expect(isActionpadBackup(backup)).toBe(true)
    expect(getPersistedDocumentFromBackup(backup)).toEqual(persisted)
  })

  it("drops transient undo and redo history from backups", () => {
    const state = createInitialOutlineState()
    const undoSnapshot: OutlineUndoSnapshot = {
      rootIds: [...state.rootIds],
      nodes: state.nodes,
      focusedNodeId: state.focusedNodeId,
      selectedThreadId: state.selectedThreadId,
      chatFocusRequest: state.chatFocusRequest,
      panelOpen: state.panelOpen,
      threads: state.threads,
      runs: state.runs,
    }
    const persisted: PersistedDocument = {
      id: "default",
      schemaVersion: 1,
      savedAt: 100,
      state: { ...state, undoStack: [undoSnapshot], redoStack: [undoSnapshot] },
    }

    const backup = createActionpadBackup(persisted, {
      exportedAt: 200,
      origin: "http://localhost:5175",
    })
    const backupDocument = getPersistedDocumentFromBackup(backup)

    expect(backupDocument?.state.undoStack).toEqual([])
    expect(backupDocument?.state.redoStack).toEqual([])
    expect(persisted.state.undoStack).toHaveLength(1)
    expect(persisted.state.redoStack).toHaveLength(1)
  })

  it("omits chat transcripts and run prompt context from backup payloads", () => {
    const state = createInitialOutlineState()
    const thread: AgentThread = {
      id: "thread-1",
      provider: "codex",
      providerThreadId: "provider-thread-1",
      nodeId: state.rootIds[0],
      messages: [{ id: "message-1", role: "user", content: "sensitive prompt", createdAt: 101 }],
      events: [{ type: "tool-completed", toolCallId: "tool-1", output: "sensitive output", createdAt: 102 }],
      runs: ["run-1"],
      lastActivityAt: 103,
      lastSeenAt: 104,
    }
    const run: AgentRun = {
      id: "run-1",
      threadId: thread.id,
      nodeId: thread.nodeId,
      provider: "codex",
      status: "succeeded",
      prompt: "sensitive run prompt",
      context: "sensitive full outline snapshot",
      createdAt: 105,
      updatedAt: 106,
      outcome: "succeeded",
      providerMetadata: { providerThreadId: thread.providerThreadId },
    }
    const persisted: PersistedDocument = {
      id: "default",
      schemaVersion: 1,
      savedAt: 100,
      state: {
        ...state,
        threads: { [thread.id]: thread },
        runs: { [run.id]: run },
      },
    }

    const backup = createActionpadBackup(persisted, {
      exportedAt: 200,
      origin: "http://localhost:5175",
    })
    const backupDocument = backup.databases[0].objectStores[0].records[0]
    const backupThread = backupDocument.state.threads[thread.id] as Record<string, unknown>
    const backupRun = backupDocument.state.runs[run.id] as Record<string, unknown>

    expect(backupThread).toMatchObject({
      id: thread.id,
      provider: "codex",
      providerThreadId: "provider-thread-1",
      nodeId: thread.nodeId,
      runs: ["run-1"],
      lastActivityAt: 103,
      lastSeenAt: 104,
    })
    expect(backupThread).not.toHaveProperty("messages")
    expect(backupThread).not.toHaveProperty("events")
    expect(backupRun).toMatchObject({
      id: run.id,
      threadId: thread.id,
      nodeId: thread.nodeId,
      provider: "codex",
      status: "succeeded",
      createdAt: 105,
      updatedAt: 106,
      outcome: "succeeded",
      providerMetadata: { providerThreadId: "provider-thread-1" },
    })
    expect(backupRun).not.toHaveProperty("prompt")
    expect(backupRun).not.toHaveProperty("context")

    expect(persisted.state.threads[thread.id].messages).toHaveLength(1)
    expect(persisted.state.threads[thread.id].events).toHaveLength(1)
    expect(persisted.state.runs[run.id].prompt).toBe("sensitive run prompt")
    expect(persisted.state.runs[run.id].context).toBe("sensitive full outline snapshot")
    expect(getPersistedDocumentFromBackup(backup)?.state.threads[thread.id]).toMatchObject({
      messages: [],
      events: [],
    })
    expect(getPersistedDocumentFromBackup(backup)?.state.runs[run.id]).toMatchObject({
      prompt: "",
      context: "",
    })
  })

  it("rejects backups without a valid persisted document record", () => {
    expect(
      isActionpadBackup({
        exportVersion: 1,
        exportedAt: 200,
        origin: "http://localhost:5175",
        databases: [
          {
            name: "actionpad",
            version: 1,
            objectStores: [{ name: "documents", keyPath: "id", records: [] }],
          },
        ],
      }),
    ).toBe(false)
  })
})
