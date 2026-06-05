import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { App } from "./App"
import { createSeededOutlineState } from "./domain/fixtures"
import type { ActionpadBackup, DocumentPersistence } from "./persistence/documentPersistence"
import { emitRuntimeEvent, setupRuntimeMocks } from "./test/runtimeMock"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test("renders the Theolabs branding below the outline pane", () => {
  const { container } = render(<App initialState={createSeededOutlineState()} />)

  const branding = container.querySelector(".app-branding")
  const outline = container.querySelector(".outline")
  const backupControls = container.querySelector(".backup-controls")
  expect(branding).not.toBeNull()
  expect(outline).not.toBeNull()
  expect(backupControls).not.toBeNull()
  if (!branding || !outline) throw new Error("Expected branding and outline to render.")
  expect(container.querySelector(".outline-pane > .backup-controls")).toBe(backupControls)
  expect(container.querySelector(".outline-pane > .app-branding")).toBe(branding)
  expect(backupControls?.compareDocumentPosition(branding)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  )
  expect(outline.compareDocumentPosition(branding)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  )
  expect(
    screen.getByRole("link", { name: "shreyans bhansali // theolabs, 2026" }),
  ).toHaveAttribute(
    "href",
    "https://www.theolabs.org",
  )
})

test("opens and closes the shortcuts modal with Cmd+/", () => {
  render(<App initialState={createSeededOutlineState()} />)

  expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts and features" })).toBeNull()

  fireEvent.keyDown(window, { key: "/", metaKey: true })

  expect(screen.getByRole("dialog", { name: "Keyboard shortcuts and features" })).toBeInTheDocument()
  expect(screen.getByText("Run or open chat")).toBeInTheDocument()
  expect(screen.getByText("Cmd + Enter")).toBeInTheDocument()

  fireEvent.keyDown(window, { key: "Escape" })

  expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts and features" })).toBeNull()
})

test("opens the shortcuts modal from the outline editor", () => {
  render(<App initialState={createSeededOutlineState()} />)

  const bullet = screen.getByDisplayValue("Actionpad Prototype")
  fireEvent.focus(bullet)
  fireEvent.keyDown(bullet, { key: "/", metaKey: true })

  expect(screen.getByRole("dialog", { name: "Keyboard shortcuts and features" })).toBeInTheDocument()
})

test("defers app refresh requests until the active run completes", async () => {
  setupRuntimeMocks()
  const reloadApp = vi.fn()
  const state = createSeededOutlineState()
  state.nodes["root-project"] = {
    ...state.nodes["root-project"],
    runStatus: "running",
    activeRunId: "run-refresh",
  }

  render(<App initialState={state} reloadApp={reloadApp} />)

  await emitRuntimeEvent({ type: "app-refresh-requested", createdAt: 100 })

  expect(reloadApp).not.toHaveBeenCalled()

  await emitRuntimeEvent({
    type: "run-completed",
    runId: "run-refresh",
    outcome: "succeeded",
    createdAt: 101,
  })

  expect(reloadApp).toHaveBeenCalledOnce()
})

test("downloads and imports IndexedDB backups through the footer controls", async () => {
  const user = userEvent.setup()
  const state = createSeededOutlineState()
  const backup: ActionpadBackup = {
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
            records: [{ id: "default", schemaVersion: 1, savedAt: 100, state }],
          },
        ],
      },
    ],
  }
  const persistence: DocumentPersistence = {
    loadDocument: async () => null,
    saveDocument: async () => undefined,
    clearDocument: async () => undefined,
    exportBackup: vi.fn(async () => backup),
    importBackup: vi.fn(async () => state),
  }
  const createObjectUrl = vi.fn((_blob: Blob) => "blob:backup")
  const revokeObjectUrl = vi.fn()
  class MockURL extends URL {
    static createObjectURL = createObjectUrl
    static revokeObjectURL = revokeObjectUrl
  }
  vi.stubGlobal("URL", MockURL)
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
  vi.spyOn(window, "confirm").mockReturnValue(true)
  const createElement = document.createElement.bind(document)
  let importInput: HTMLInputElement | null = null
  vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
    const element = createElement(tagName, options)
    if (tagName === "input") {
      importInput = element as HTMLInputElement
      vi.spyOn(importInput, "click").mockImplementation(() => undefined)
    }
    return element
  })

  render(<App initialState={state} persistence={persistence} />)

  await user.click(screen.getByRole("button", { name: "Download backup" }))

  expect(persistence.exportBackup).toHaveBeenCalledTimes(1)
  expect(createObjectUrl).toHaveBeenCalledTimes(1)
  expect(revokeObjectUrl).toHaveBeenCalledWith("blob:backup")

  await user.click(screen.getByRole("button", { name: "Import backup" }))
  if (!importInput) throw new Error("Expected import input.")

  fireEvent.change(importInput, {
    target: {
      files: [
        new File([JSON.stringify(backup)], "actionpad-backup.json", { type: "application/json" }),
      ],
    },
  })

  await waitFor(() => {
    expect(window.confirm).toHaveBeenCalledWith(
      "Import this Actionpad backup? This will replace the current local document.",
    )
  })
  expect(persistence.importBackup).toHaveBeenCalledWith(backup)
})

test("shows progress while preparing an IndexedDB backup", async () => {
  const user = userEvent.setup()
  const state = createSeededOutlineState()
  const backup: ActionpadBackup = {
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
            records: [{ id: "default", schemaVersion: 1, savedAt: 100, state }],
          },
        ],
      },
    ],
  }
  let resolveExport: (backup: ActionpadBackup | null) => void = () => undefined
  const persistence: DocumentPersistence = {
    loadDocument: async () => null,
    saveDocument: async () => undefined,
    clearDocument: async () => undefined,
    exportBackup: vi.fn(
      () =>
        new Promise<ActionpadBackup | null>((resolve) => {
          resolveExport = resolve
        }),
    ),
    importBackup: vi.fn(async () => state),
  }
  const createObjectUrl = vi.fn((_blob: Blob) => "blob:backup")
  const revokeObjectUrl = vi.fn()
  class MockURL extends URL {
    static createObjectURL = createObjectUrl
    static revokeObjectURL = revokeObjectUrl
  }
  vi.stubGlobal("URL", MockURL)
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)

  render(<App initialState={state} persistence={persistence} />)

  await user.click(screen.getByRole("button", { name: "Download backup" }))

  expect(screen.getByText("Preparing backup...")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Download backup" })).toBeDisabled()

  resolveExport(backup)

  await waitFor(() => {
    expect(screen.getByText("Backup downloaded.")).toBeInTheDocument()
  })
})

test("downloads large IndexedDB backups without stringifying the whole backup at once", async () => {
  const user = userEvent.setup()
  const state = createSeededOutlineState()
  const backup: ActionpadBackup = {
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
            records: [
              {
                id: "default",
                schemaVersion: 1,
                savedAt: 100,
                state: {
                  ...state,
                  threads: {
                    ...state.threads,
                    "thread-large": {
                      id: "thread-large",
                      provider: "codex",
                      providerThreadId: null,
                      nodeId: "root-project",
                      messages: [
                        {
                          id: "message-large",
                          role: "assistant",
                          content: "x".repeat(80),
                          createdAt: 100,
                          status: "complete",
                        },
                      ],
                      events: [],
                      runs: [],
                    },
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  }
  const persistence: DocumentPersistence = {
    loadDocument: async () => null,
    saveDocument: async () => undefined,
    clearDocument: async () => undefined,
    exportBackup: vi.fn(async () => backup),
    importBackup: vi.fn(async () => state),
  }
  const createObjectUrl = vi.fn((_blob: Blob) => "blob:backup")
  class MockURL extends URL {
    static createObjectURL = createObjectUrl
    static revokeObjectURL = vi.fn()
  }
  vi.stubGlobal("URL", MockURL)
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
  const originalStringify = JSON.stringify
  vi.spyOn(JSON, "stringify").mockImplementation((value, replacer, space) => {
    if (value === backup) throw new RangeError("Invalid string length")
    return originalStringify(value, replacer, space)
  })

  render(<App initialState={state} persistence={persistence} />)

  await user.click(screen.getByRole("button", { name: "Download backup" }))

  await waitFor(() => {
    expect(screen.getByText("Backup downloaded.")).toBeInTheDocument()
  })
  expect(createObjectUrl).toHaveBeenCalledTimes(1)
  const blob = createObjectUrl.mock.calls[0][0]
  await expect(
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ""))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(blob)
    }),
  ).resolves.toBe(`${originalStringify(backup)}\n`)
})
