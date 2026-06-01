import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { act } from "react"
import { afterEach, beforeEach, vi } from "vitest"
import { App } from "../App"
import { createSeededOutlineState } from "../domain/fixtures"
import {
  emitRunStartedForLastRequest,
  emitRuntimeEvent,
  getLastStartRunRequest,
  setupRuntimeMocks,
} from "../test/runtimeMock"

let fetchMock: ReturnType<typeof setupRuntimeMocks>

beforeEach(() => {
  fetchMock = setupRuntimeMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderSeededApp() {
  return render(<App initialState={createSeededOutlineState()} />)
}

function rowForBullet(text: string): HTMLElement {
  const row = screen.getByDisplayValue(text).closest(".bullet-row")
  if (!(row instanceof HTMLElement)) {
    throw new Error(`Expected bullet row for ${text}`)
  }
  return row
}

async function runNowFromKeyboard(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Meta>}{Enter}{/Meta}")
  await user.keyboard("{Enter}")
}

test("hydrates the outline from persisted state", async () => {
  const persisted = createSeededOutlineState()
  persisted.nodes["research-products"].text = "Persisted research"
  const persistence = {
    loadDocument: vi.fn().mockResolvedValue(persisted),
    saveDocument: vi.fn().mockResolvedValue(undefined),
    clearDocument: vi.fn().mockResolvedValue(undefined),
  }

  render(<App persistence={persistence} />)

  expect(await screen.findByDisplayValue("Persisted research")).toBeInTheDocument()
})

test("debounces persisted saves after edits", async () => {
  vi.useFakeTimers()
  try {
    const persistence = {
      loadDocument: vi.fn().mockResolvedValue(null),
      saveDocument: vi.fn().mockResolvedValue(undefined),
      clearDocument: vi.fn().mockResolvedValue(undefined),
    }

    render(<App persistence={persistence} />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const bullet = screen.getByLabelText(/bullet text/i)
    fireEvent.change(bullet, { target: { value: "Saved locally" } })

    expect(persistence.saveDocument).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(persistence.saveDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: expect.objectContaining({
          root: expect.objectContaining({ text: "Saved locally" }),
        }),
      }),
    )
  } finally {
    vi.useRealTimers()
  }
})

test("renders visible outline rows and edits bullet text", async () => {
  const user = userEvent.setup()
  renderSeededApp()

  const bullet = screen.getByDisplayValue("Find adjacent products and patterns")

  expect(screen.getByLabelText("Executable outline")).toBeInTheDocument()
  expect(screen.getByDisplayValue("Actionpad Prototype")).toBeInTheDocument()
  expect(
    screen.getByRole("textbox", { name: /bullet text: actionpad prototype/i }),
  ).toHaveValue("Actionpad Prototype")

  await user.clear(bullet)
  await user.type(bullet, "Map editor interactions")

  expect(screen.getByDisplayValue("Map editor interactions")).toBeInTheDocument()
})

test("bullet markers show created and first-run timestamps in a menu-styled hover tooltip", () => {
  const initialState = createSeededOutlineState()
  const createdAt = 1_700_000_000_000
  const firstRunAt = 1_700_000_060_000
  const nodeId = `node-${createdAt}-1`
  initialState.rootIds = [nodeId]
  initialState.focusedNodeId = nodeId
  initialState.nodes = {
    [nodeId]: {
      id: nodeId,
      parentId: null,
      children: [],
      text: "Timestamped bullet",
      collapsed: false,
      runStatus: "succeeded",
      threadId: "thread-1",
      metadata: {},
    },
  }
  initialState.threads = {
    "thread-1": {
      id: "thread-1",
      provider: "codex",
      providerThreadId: null,
      nodeId,
      messages: [],
      events: [{ type: "run-started", nodeId, runId: "run-1", createdAt: firstRunAt }],
      runs: ["run-1"],
    },
  }
  initialState.runs = {
    "run-1": {
      id: "run-1",
      threadId: "thread-1",
      nodeId,
      provider: "codex",
      status: "succeeded",
      prompt: "Timestamped bullet",
      context: "Timestamped bullet",
      createdAt: firstRunAt,
      updatedAt: firstRunAt,
      providerMetadata: {},
    },
  }
  render(<App initialState={initialState} />)

  const row = rowForBullet("Timestamped bullet")
  const marker = row.querySelector(".bullet-marker")
  expect(marker).not.toBeNull()

  expect(row).not.toHaveAttribute("title")
  expect(marker).not.toHaveAttribute("title")

  fireEvent.mouseEnter(marker as Element)

  const tooltip = screen.getByRole("tooltip")
  expect(tooltip).toHaveClass("run-command-palette")
  expect(tooltip).toHaveTextContent(`Created${new Date(createdAt).toLocaleString()}`)
  expect(tooltip).toHaveTextContent(`First run${new Date(firstRunAt).toLocaleString()}`)

  fireEvent.mouseLeave(marker as Element)

  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
})

test("enter creates a new row and moves focus to the new input", async () => {
  const user = userEvent.setup()
  renderSeededApp()

  const bullet = screen.getByDisplayValue("Find adjacent products and patterns")
  await user.click(bullet)
  await user.keyboard("{Enter}")

  await waitFor(() => expect(document.activeElement).toHaveValue(""))
  expect(screen.getAllByDisplayValue("")).toHaveLength(1)
})

test("enter on an expanded bullet with children creates a first child", async () => {
  const user = userEvent.setup()
  renderSeededApp()

  const bullet = screen.getByDisplayValue("Research")
  await user.click(bullet)
  await user.keyboard("{Enter}")

  await waitFor(() => expect(document.activeElement).toHaveValue(""))
  expect(
    screen.getAllByRole("textbox").map((input) => (input as HTMLTextAreaElement).value),
  ).toEqual([
    "Actionpad Prototype",
    "Research",
    "",
    "Find adjacent products and patterns",
    "Sketch the first interaction loop",
  ])
})

test("enter on a collapsed bullet with children still creates a sibling", async () => {
  const user = userEvent.setup()
  renderSeededApp()

  const bullet = screen.getByDisplayValue("Research")
  await user.click(bullet)
  await user.keyboard("{Meta>}{ArrowUp}{/Meta}")
  await user.keyboard("{Enter}")

  await waitFor(() => expect(document.activeElement).toHaveValue(""))
  expect(
    screen.getAllByRole("textbox").map((input) => (input as HTMLTextAreaElement).value),
  ).toEqual(["Actionpad Prototype", "Research", "", "Sketch the first interaction loop"])
})

test("backspace on an empty bullet deletes it and focuses the previous visible bullet", async () => {
  const user = userEvent.setup()
  renderSeededApp()

  const bullet = screen.getByDisplayValue("Find adjacent products and patterns")
  await user.click(bullet)
  await user.keyboard("{Enter}")

  const emptyBullet = await screen.findByDisplayValue("")
  await waitFor(() => expect(emptyBullet).toHaveFocus())

  await user.keyboard("{Backspace}")

  await waitFor(() => expect(screen.queryByDisplayValue("")).not.toBeInTheDocument())
  await waitFor(() =>
    expect(screen.getByDisplayValue("Find adjacent products and patterns")).toHaveFocus(),
  )
})

test("cmd z walks backward through outline actions", async () => {
  const user = userEvent.setup()
  renderSeededApp()

  const bullet = screen.getByDisplayValue("Find adjacent products and patterns")
  await user.click(bullet)
  await user.keyboard("{Enter}")

  const emptyBullet = await screen.findByDisplayValue("")
  await waitFor(() => expect(emptyBullet).toHaveFocus())
  await user.keyboard("{Backspace}")
  await waitFor(() => expect(screen.queryByDisplayValue("")).not.toBeInTheDocument())

  fireEvent.keyDown(screen.getByDisplayValue("Find adjacent products and patterns"), {
    key: "z",
    metaKey: true,
  })

  const restoredBullet = await screen.findByDisplayValue("")
  await waitFor(() => expect(restoredBullet).toHaveFocus())
  expect(
    screen.getAllByRole("textbox").map((input) => (input as HTMLTextAreaElement).value),
  ).toEqual([
    "Actionpad Prototype",
    "Research",
    "Find adjacent products and patterns",
    "",
    "Sketch the first interaction loop",
  ])

  fireEvent.keyDown(restoredBullet, {
    key: "z",
    metaKey: true,
  })

  await waitFor(() => expect(screen.queryByDisplayValue("")).not.toBeInTheDocument())
  expect(
    screen.getAllByRole("textbox").map((input) => (input as HTMLTextAreaElement).value),
  ).toEqual([
    "Actionpad Prototype",
    "Research",
    "Find adjacent products and patterns",
    "Sketch the first interaction loop",
  ])
})

test("cmd z undoes bullet text edits", async () => {
  renderSeededApp()

  const bullet = screen.getByDisplayValue("Find adjacent products and patterns")
  fireEvent.change(bullet, { target: { value: "Find references" } })
  expect(screen.getByDisplayValue("Find references")).toBeInTheDocument()

  fireEvent.keyDown(screen.getByDisplayValue("Find references"), {
    key: "z",
    metaKey: true,
  })

  await waitFor(() =>
    expect(screen.getByDisplayValue("Find adjacent products and patterns")).toBeInTheDocument(),
  )
})

test("leaf marker is decorative instead of a collapse button", () => {
  renderSeededApp()

  const leafRow = rowForBullet("Find adjacent products and patterns")

  expect(within(leafRow).queryByRole("button", { name: /collapse bullet/i })).not.toBeInTheDocument()
  expect(within(leafRow).getByText("•")).toHaveAttribute("aria-hidden", "true")
})

test("leaf row exposes a pointer drag handle outside the keyboard tab order", () => {
  renderSeededApp()

  const leafRow = rowForBullet("Find adjacent products and patterns")
  const dragHandle = within(leafRow).getByLabelText("Drag bullet")

  expect(dragHandle).toHaveAttribute("tabindex", "-1")
  expect(within(leafRow).getByText("•")).toHaveAttribute("aria-hidden", "true")
})

test("parent disclosure button remains in the keyboard tab order", () => {
  renderSeededApp()

  const parentRow = rowForBullet("Research")
  const disclosureButton = within(parentRow).getByRole("button", { name: /collapse bullet/i })

  expect(disclosureButton).not.toHaveAttribute("tabindex", "-1")
})

test("clicking the drag handle focuses its row", async () => {
  const user = userEvent.setup()
  renderSeededApp()

  const leafRow = rowForBullet("Find adjacent products and patterns")
  const otherInput = screen.getByDisplayValue("Actionpad Prototype")

  await user.click(otherInput)
  expect(leafRow).not.toHaveClass("is-focused")

  await user.click(within(leafRow).getByLabelText("Drag bullet"))

  await waitFor(() => expect(leafRow).toHaveClass("is-focused"))
})

test("focusing a chat row control focuses the row", async () => {
  const user = userEvent.setup()
  renderSeededApp()

  const leafRow = rowForBullet("Find adjacent products and patterns")
  const sourceInput = screen.getByDisplayValue("Find adjacent products and patterns")
  fireEvent.keyDown(sourceInput, { key: "Enter", metaKey: true })
  fireEvent.keyDown(sourceInput, { key: "Enter" })
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  await emitRunStartedForLastRequest(fetchMock)
  const request = getLastStartRunRequest(fetchMock)
  await emitRuntimeEvent({
    type: "run-completed",
    runId: `run-${request.nodeId}`,
    createdAt: 120,
  })

  const chatButton = await within(leafRow).findByRole(
    "button",
    { name: /open bullet chat/i },
    { timeout: 1500 },
  )
  await user.click(screen.getByDisplayValue("Actionpad Prototype"))
  expect(leafRow).not.toHaveClass("is-focused")
  expect(chatButton).toHaveAttribute("tabindex", "-1")

  await act(async () => {
    chatButton.focus()
  })

  await waitFor(() => expect(leafRow).toHaveClass("is-focused"))
  expect(chatButton).toHaveAttribute("tabindex", "0")
})

test("cmd-enter opens the run command palette before starting the runtime", async () => {
  const user = userEvent.setup()
  renderSeededApp()

  const bullet = screen.getByDisplayValue("Find adjacent products and patterns")
  await user.click(bullet)
  await user.keyboard("{Meta>}{Enter}{/Meta}")

  const palette = await screen.findByRole("listbox", { name: /run command palette/i })
  expect(within(palette).getByRole("option", { name: /run now/i })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  expect(within(palette).getByRole("option", { name: /run after/i })).toBeInTheDocument()
  expect(within(palette).getByRole("option", { name: /run at/i })).toBeInTheDocument()
  expect(fetchMock).not.toHaveBeenCalled()

  await user.keyboard("{Enter}")

  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  expect(screen.queryByRole("listbox", { name: /run command palette/i })).not.toBeInTheDocument()
})

test("cmd-enter includes active filesystem mentions in the run request", async () => {
  const user = userEvent.setup()
  const initialState = createSeededOutlineState()
  initialState.nodes["research-products"] = {
    ...initialState.nodes["research-products"],
    text: "Summarize @README.md",
    metadata: {
      mentions: [
        {
          id: "mention-active",
          kind: "file",
          path: "/repo/README.md",
          label: "README.md",
          token: "@README.md",
          createdAt: 100,
        },
        {
          id: "mention-stale",
          kind: "file",
          path: "/repo/stale.md",
          label: "stale.md",
          token: "@stale.md",
          createdAt: 101,
        },
      ],
    },
  }
  render(<App initialState={initialState} />)

  await user.click(screen.getByDisplayValue("Summarize @README.md"))
  await runNowFromKeyboard(user)

  expect(getLastStartRunRequest(fetchMock).mentions).toEqual([
    {
      id: "mention-active",
      kind: "file",
      path: "/repo/README.md",
      label: "README.md",
      token: "@README.md",
      createdAt: 100,
    },
  ])
})

test("unfocused rows render filesystem mentions as subtle filename chips", () => {
  const initialState = createSeededOutlineState()
  initialState.focusedNodeId = "root-project"
  initialState.nodes["ui-exploration"] = {
    ...initialState.nodes["ui-exploration"],
    text: "Review @/repo/docs/Product Brief.md before planning",
    metadata: {
      mentions: [
        {
          id: "mention-brief",
          kind: "file",
          path: "/repo/docs/Product Brief.md",
          label: "Product Brief.md",
          token: "@/repo/docs/Product Brief.md",
          createdAt: 100,
        },
      ],
    },
  }
  render(<App initialState={initialState} />)

  const row = rowForBullet("Review @/repo/docs/Product Brief.md before planning")
  const chip = within(row).getByText("Product Brief.md")

  expect(chip).toHaveClass("mention-chip")
  expect(chip).toHaveAttribute("title", "/repo/docs/Product Brief.md")
  expect(within(row).queryByText("@/repo/docs/Product Brief.md")).not.toBeInTheDocument()
})

test("unfocused rows render markdown filesystem links as subtle chips without mention metadata", () => {
  const initialState = createSeededOutlineState()
  initialState.focusedNodeId = "root-project"
  initialState.nodes["ui-exploration"] = {
    ...initialState.nodes["ui-exploration"],
    text: "Open [playnotes](<@/Users/shreyans/Dropbox/Code/puck/plainoats>) next",
    metadata: {},
  }
  render(<App initialState={initialState} />)

  const row = rowForBullet(
    "Open [playnotes](<@/Users/shreyans/Dropbox/Code/puck/plainoats>) next",
  )
  const chip = within(row).getByText("playnotes")

  expect(chip).toHaveClass("mention-chip")
  expect(chip).toHaveAttribute("title", "/Users/shreyans/Dropbox/Code/puck/plainoats")
  expect(
    within(row).queryByText("[playnotes](<@/Users/shreyans/Dropbox/Code/puck/plainoats>)"),
  ).not.toBeInTheDocument()
})

test("unfocused rows render basic inline markdown", () => {
  const initialState = createSeededOutlineState()
  initialState.focusedNodeId = "root-project"
  initialState.nodes["ui-exploration"] = {
    ...initialState.nodes["ui-exploration"],
    text: "Read [Product docs](https://example.com/docs) and **ship** with `notes`",
  }
  render(<App initialState={initialState} />)

  const row = rowForBullet(
    "Read [Product docs](https://example.com/docs) and **ship** with `notes`",
  )
  const link = within(row).getByRole("link", { name: "Product docs" })

  expect(link).toHaveAttribute("href", "https://example.com/docs")
  expect(within(row).getByText("ship")).toHaveClass("markdown-strong")
  expect(within(row).getByText("notes")).toHaveClass("markdown-code")
  expect(
    within(row).queryByText("[Product docs](https://example.com/docs)"),
  ).not.toBeInTheDocument()
})

test("bullet editor disables spelling corrections for filesystem paths", () => {
  const initialState = createSeededOutlineState()
  initialState.focusedNodeId = "ui-exploration"
  initialState.nodes["ui-exploration"] = {
    ...initialState.nodes["ui-exploration"],
    text: "Review @/repo/docs/Product Brief.md before planning",
    metadata: {
      mentions: [
        {
          id: "mention-brief",
          kind: "file",
          path: "/repo/docs/Product Brief.md",
          label: "Product Brief.md",
          token: "@/repo/docs/Product Brief.md",
          createdAt: 100,
        },
      ],
    },
  }
  render(<App initialState={initialState} />)

  const editor = screen.getByDisplayValue("Review @/repo/docs/Product Brief.md before planning")

  expect(editor).toHaveAttribute("spellcheck", "false")
  expect(editor).toHaveAttribute("autocorrect", "off")
  expect(editor).toHaveAttribute("autocapitalize", "off")
})

test("typing at inserts filesystem mentions as markdown links", async () => {
  const user = userEvent.setup()
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes("/filesystem/list")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            path: "/repo",
            parentPath: "/",
            entries: [
              { name: "Product Brief.md", path: "/repo/docs/Product Brief.md", kind: "file" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
    }
    return Promise.resolve(new Response(null, { status: init?.method === "POST" ? 202 : 200 }))
  })
  renderSeededApp()

  const bullet = screen.getByDisplayValue("Find adjacent products and patterns")
  await user.clear(bullet)
  await user.type(bullet, "Review @")

  expect(await screen.findByRole("option", { name: /Product Brief.md file/i })).toBeInTheDocument()

  await user.keyboard("{Enter}")

  expect(document.activeElement).toHaveValue(
    "Review [Product Brief.md](<@/repo/docs/Product Brief.md>) ",
  )
  await runNowFromKeyboard(user)
  expect(getLastStartRunRequest(fetchMock).mentions).toEqual([
    expect.objectContaining({
      kind: "file",
      path: "/repo/docs/Product Brief.md",
      label: "Product Brief.md",
      token: "[Product Brief.md](<@/repo/docs/Product Brief.md>)",
    }),
  ])
})

test("typing at opens filesystem mentions and inserts the selected entry", async () => {
  const user = userEvent.setup()
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes("/filesystem/list")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            path: "/repo",
            parentPath: "/",
            entries: [
              { name: "src", path: "/repo/src", kind: "folder" },
              { name: "README.md", path: "/repo/README.md", kind: "file" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
    }
    return Promise.resolve(new Response(null, { status: init?.method === "POST" ? 202 : 200 }))
  })
  renderSeededApp()

  const bullet = screen.getByDisplayValue("Find adjacent products and patterns")
  await user.clear(bullet)
  await user.type(bullet, "Use @")

  const palette = await screen.findByRole("listbox", { name: /filesystem mentions/i })
  expect(within(palette).getByRole("option", { name: /src folder/i })).toBeInTheDocument()

  await user.keyboard("{Enter}")

  expect(document.activeElement).toHaveValue("Use [src](<@/repo/src>) ")
  await runNowFromKeyboard(user)
  expect(getLastStartRunRequest(fetchMock).mentions).toEqual([
    expect.objectContaining({
      kind: "folder",
      path: "/repo/src",
      label: "src",
      token: "[src](<@/repo/src>)",
    }),
  ])
})

test("tab enters a selected mention folder while enter selects it", async () => {
  const user = userEvent.setup()
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname === "/filesystem/list") {
      const path = url.searchParams.get("path")
      return Promise.resolve(
        new Response(
          JSON.stringify(
            path === "/repo/Library"
              ? {
                  path: "/repo/Library",
                  parentPath: "/repo",
                  entries: [
                    {
                      name: "CloudStorage",
                      path: "/repo/Library/CloudStorage",
                      kind: "folder",
                    },
                    { name: "Caches", path: "/repo/Library/Caches", kind: "folder" },
                  ],
                }
              : {
                  path: "/repo",
                  parentPath: "/",
                  entries: [
                    { name: "Applications", path: "/repo/Applications", kind: "folder" },
                    { name: "Library", path: "/repo/Library", kind: "folder" },
                  ],
                },
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
    }
    return Promise.resolve(new Response(null, { status: init?.method === "POST" ? 202 : 200 }))
  })
  renderSeededApp()

  const bullet = screen.getByDisplayValue("Find adjacent products and patterns")
  await user.clear(bullet)
  await user.type(bullet, "Use @li")

  expect(await screen.findByRole("option", { name: /Library folder/i })).toBeInTheDocument()

  await user.keyboard("{Tab}")
  expect(document.activeElement).toHaveValue("Use @/repo/Library/")
  await user.type(document.activeElement as HTMLTextAreaElement, "clo")

  expect(await screen.findByRole("option", { name: /CloudStorage folder/i })).toBeInTheDocument()
  await user.keyboard("{Enter}")

  expect(document.activeElement).toHaveValue("Use [CloudStorage](<@/repo/Library/CloudStorage>) ")
  await runNowFromKeyboard(user)
  expect(getLastStartRunRequest(fetchMock).mentions).toEqual([
    expect.objectContaining({
      kind: "folder",
      path: "/repo/Library/CloudStorage",
      label: "CloudStorage",
      token: "[CloudStorage](<@/repo/Library/CloudStorage>)",
    }),
  ])
})

test("generated rows use quieter text without row controls or labels", async () => {
  renderSeededApp()

  expect(screen.queryByRole("button", { name: /execute bullet/i })).not.toBeInTheDocument()

  const sourceInput = screen.getByDisplayValue("Find adjacent products and patterns")
  fireEvent.keyDown(sourceInput, { key: "Enter", metaKey: true })
  fireEvent.keyDown(sourceInput, { key: "Enter" })
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  const request = await emitRunStartedForLastRequest(fetchMock)
  const runId = `run-${request.nodeId}`
  await emitRuntimeEvent({
    type: "outline-patch",
    runId,
    patch: {
      type: "append-child-bullets",
      parentId: request.nodeId,
      bullets: [{ text: "Clarify the next action." }],
    },
    createdAt: 130,
  })

  const generatedInput = await screen.findByDisplayValue("Clarify the next action.")
  const generatedRow = generatedInput.closest(".bullet-row")

  expect(generatedRow).toHaveClass("is-generated")
  expect(within(generatedRow as HTMLElement).queryByText("generated")).not.toBeInTheDocument()
  expect(
    within(generatedRow as HTMLElement).queryByRole("button", { name: /execute bullet/i }),
  ).not.toBeInTheDocument()
})

test("completed runs with generated child output show a green completion control", async () => {
  renderSeededApp()

  const sourceInput = screen.getByDisplayValue("Find adjacent products and patterns")
  fireEvent.keyDown(sourceInput, { key: "Enter", metaKey: true })
  fireEvent.keyDown(sourceInput, { key: "Enter" })
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  const request = await emitRunStartedForLastRequest(fetchMock)
  const runId = `run-${request.nodeId}`
  await emitRuntimeEvent({
    type: "outline-patch",
    runId,
    patch: {
      type: "append-child-bullets",
      parentId: request.nodeId,
      bullets: [{ text: "Clarify the next action." }],
    },
    createdAt: 130,
  })
  await emitRuntimeEvent({ type: "run-completed", runId, createdAt: 140 })

  const sourceRow = rowForBullet("Find adjacent products and patterns")
  const completionButton = await within(sourceRow).findByRole("button", {
    name: /open completed bullet chat/i,
  })

  expect(completionButton).toHaveClass("is-complete")
})

test("completed runs with incomplete assistant outcome show an orange question control", async () => {
  renderSeededApp()

  const sourceInput = screen.getByDisplayValue("Find adjacent products and patterns")
  fireEvent.keyDown(sourceInput, { key: "Enter", metaKey: true })
  fireEvent.keyDown(sourceInput, { key: "Enter" })
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  const request = await emitRunStartedForLastRequest(fetchMock)
  const runId = `run-${request.nodeId}`
  await emitRuntimeEvent({
    type: "outline-patch",
    runId,
    patch: {
      type: "append-child-bullets",
      parentId: request.nodeId,
      outcome: "incomplete",
      bullets: [{ text: "Which account should I use?" }],
    },
    createdAt: 130,
  })
  await emitRuntimeEvent({ type: "run-completed", runId, outcome: "incomplete", createdAt: 140 })

  const sourceRow = rowForBullet("Find adjacent products and patterns")
  const questionButton = await within(sourceRow).findByRole("button", {
    name: /open incomplete bullet chat/i,
  })

  expect(questionButton).toHaveClass("is-incomplete")
})

test("expanded ancestor rows do not show a child-running spinner for visible running descendants", () => {
  const initialState = createSeededOutlineState()
  initialState.nodes["research-products"] = {
    ...initialState.nodes["research-products"],
    runStatus: "running",
  }
  render(<App initialState={initialState} />)

  const parentRow = rowForBullet("Research")

  expect(within(parentRow).queryByLabelText("Child running")).not.toBeInTheDocument()
})

test("collapsed ancestor rows show a running spinner when a descendant is hidden", () => {
  const initialState = createSeededOutlineState()
  initialState.nodes.research = {
    ...initialState.nodes.research,
    collapsed: true,
  }
  initialState.nodes["research-products"] = {
    ...initialState.nodes["research-products"],
    runStatus: "running",
  }
  render(<App initialState={initialState} />)

  const parentRow = rowForBullet("Research")
  const rootRow = rowForBullet("Actionpad Prototype")

  expect(screen.queryByDisplayValue("Find adjacent products and patterns")).not.toBeInTheDocument()
  expect(within(parentRow).getByLabelText("Child running")).toBeInTheDocument()
  expect(within(rootRow).queryByLabelText("Child running")).not.toBeInTheDocument()
})

test("collapsed ancestor rows show an unread dot when generated output is hidden", () => {
  const initialState = createSeededOutlineState()
  initialState.nodes.research = {
    ...initialState.nodes.research,
    collapsed: true,
    threadId: "thread-1",
  }
  initialState.threads["thread-1"] = {
    id: "thread-1",
    provider: "codex",
    providerThreadId: null,
    nodeId: "research",
    messages: [],
    events: [],
    runs: [],
  }
  initialState.nodes["research-products"] = {
    ...initialState.nodes["research-products"],
    children: ["generated-1"],
  }
  initialState.nodes["generated-1"] = {
    id: "generated-1",
    parentId: "research-products",
    children: [],
    text: "Clarify the next action.",
    collapsed: false,
    runStatus: "idle",
    metadata: { generated: true, unread: true },
  }
  render(<App initialState={initialState} />)

  const parentRow = rowForBullet("Research")

  expect(screen.queryByDisplayValue("Clarify the next action.")).not.toBeInTheDocument()
  expect(within(parentRow).getByLabelText("Unread output")).toBeInTheDocument()
  expect(within(parentRow).getByRole("button", { name: /open bullet chat/i })).toBeInTheDocument()
})

test("generated output is marked read after it is displayed in the outline", async () => {
  const user = userEvent.setup()
  const initialState = createSeededOutlineState()
  initialState.nodes.research = {
    ...initialState.nodes.research,
    collapsed: true,
  }
  initialState.nodes["research-products"] = {
    ...initialState.nodes["research-products"],
    children: ["generated-1"],
  }
  initialState.nodes["generated-1"] = {
    id: "generated-1",
    parentId: "research-products",
    children: [],
    text: "Clarify the next action.",
    collapsed: false,
    runStatus: "idle",
    metadata: { generated: true, unread: true },
  }
  render(<App initialState={initialState} />)

  const parentRow = rowForBullet("Research")
  expect(within(parentRow).getByLabelText("Unread output")).toBeInTheDocument()

  await user.click(within(parentRow).getByRole("button", { name: /expand bullet/i }))

  const generatedRow = rowForBullet("Clarify the next action.")
  await waitFor(() =>
    expect(within(generatedRow).queryByLabelText("Unread output")).not.toBeInTheDocument(),
  )
  expect(within(parentRow).queryByLabelText("Unread output")).not.toBeInTheDocument()
})

test("plain arrow navigation moves focus to the adjacent visible bullet editor", async () => {
  const user = userEvent.setup()
  renderSeededApp()

  const current = screen.getByDisplayValue(
    "Find adjacent products and patterns",
  ) as HTMLTextAreaElement
  await user.click(current)
  current.setSelectionRange(current.value.length, current.value.length)
  await user.keyboard("{ArrowDown}")

  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByDisplayValue("Sketch the first interaction loop"),
    ),
  )
})

test("plain arrow navigation stays inside multiline bullet text before the boundary", async () => {
  const user = userEvent.setup()
  renderSeededApp()

  const current = screen.getByDisplayValue(
    "Find adjacent products and patterns",
  ) as HTMLTextAreaElement
  await user.click(current)
  fireEvent.change(current, { target: { value: "First line\nSecond line" } })
  current.setSelectionRange(3, 3)

  const nativeNavigationHandled = fireEvent.keyDown(current, { key: "ArrowDown" })

  expect(nativeNavigationHandled).toBe(true)
  expect(document.activeElement).toBe(current)
})

test("shift arrow selection stays inside the focused bullet editor", async () => {
  const user = userEvent.setup()
  renderSeededApp()

  const current = screen.getByDisplayValue("Find adjacent products and patterns") as HTMLTextAreaElement
  await user.click(current)
  current.setSelectionRange(0, 0)

  const nativeSelectionHandled = fireEvent.keyDown(current, { key: "ArrowRight", shiftKey: true })

  expect(nativeSelectionHandled).toBe(true)
  expect(document.activeElement).toBe(current)
})

test("shift enter inserts a newline inside the focused bullet editor", async () => {
  const user = userEvent.setup()
  renderSeededApp()

  const current = screen.getByDisplayValue("Find adjacent products and patterns") as HTMLTextAreaElement
  await user.click(current)
  current.setSelectionRange(4, 4)

  await user.keyboard("{Shift>}{Enter}{/Shift}")

  expect(current).toHaveValue("Find\n adjacent products and patterns")
  expect(screen.queryByDisplayValue("")).not.toBeInTheDocument()
})

test("option arrow reorders a bullet within its siblings", async () => {
  const user = userEvent.setup()
  renderSeededApp()

  const bullet = screen.getByDisplayValue("Sketch the first interaction loop")
  await user.click(bullet)
  await user.keyboard("{Alt>}{ArrowUp}{/Alt}")

  const values = screen.getAllByRole("textbox").map((input) => (input as HTMLInputElement).value)
  expect(values).toEqual([
    "Actionpad Prototype",
    "Sketch the first interaction loop",
    "Research",
    "Find adjacent products and patterns",
  ])
  expect(document.activeElement).toBe(screen.getByDisplayValue("Sketch the first interaction loop"))
})

test("cmd shift arrow moves a bullet across parent sibling boundaries at the same depth", async () => {
  const user = userEvent.setup()
  renderSeededApp()

  const bullet = screen.getByDisplayValue("Find adjacent products and patterns")
  await user.click(bullet)
  fireEvent.keyDown(bullet, { key: "ArrowDown", metaKey: true, shiftKey: true })

  await waitFor(() =>
    expect(screen.getAllByRole("textbox").map((input) => (input as HTMLTextAreaElement).value))
      .toEqual([
        "Actionpad Prototype",
        "Research",
        "Sketch the first interaction loop",
        "Find adjacent products and patterns",
      ]),
  )
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByDisplayValue("Find adjacent products and patterns")),
  )
})
