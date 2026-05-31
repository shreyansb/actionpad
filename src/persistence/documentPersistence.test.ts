import { describe, expect, it, vi } from "vitest"
import { createInitialOutlineState } from "../domain/fixtures"
import { createIndexedDbDocumentPersistence, isPersistedDocument } from "./documentPersistence"

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
})
