import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, vi } from "vitest"
import { App } from "../App"
import { createInitialOutlineState } from "../domain/fixtures"
import {
  emitRunStartedForLastRequest,
  emitRuntimeEvent,
  getLastStartRunRequest,
  setupRuntimeMocks,
} from "../test/runtimeMock"

let fetchMock: ReturnType<typeof setupRuntimeMocks>

beforeEach(() => {
  vi.stubEnv("VITE_ACTIONPAD_RUNTIME_URL", "http://127.0.0.1:43217")
  fetchMock = setupRuntimeMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderBlankApp() {
  return render(<App initialState={createInitialOutlineState()} />)
}

async function runBulletWithCmdEnter(user: ReturnType<typeof userEvent.setup>, text: string) {
  const bullet = await prepareBullet(user, text)
  await user.click(bullet)
  await runNowFromKeyboard(user)
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  await emitRunStartedForLastRequest(fetchMock)
  await runNowFromKeyboard(user)
  return bullet
}

async function runNowFromKeyboard(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Meta>}{Enter}{/Meta}")
}

async function prepareBullet(user: ReturnType<typeof userEvent.setup>, text: string) {
  const existing = screen.queryByDisplayValue(text) as HTMLTextAreaElement | null
  if (existing) return existing
  const bullet = screen.getByLabelText(/bullet text/i)
  await user.click(bullet)
  await user.clear(bullet)
  await user.type(bullet, text)
  return screen.getByDisplayValue(text)
}

test("cmd enter sends focused bullet context to the runtime", async () => {
  const user = userEvent.setup()
  renderBlankApp()

  const bullet = await prepareBullet(user, "Find adjacent products and patterns")
  await user.click(bullet)
  await runNowFromKeyboard(user)

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43217/runs",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Find adjacent products and patterns"),
      }),
    ),
  )
  expect(
    screen.queryByRole("complementary", { name: /bullet chat panel/i }),
  ).not.toBeInTheDocument()
})

test("runtime startup failure marks the bullet failed with a useful message", async () => {
  const user = userEvent.setup()
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:43217")),
  )
  renderBlankApp()

  const bullet = await prepareBullet(user, "Find adjacent products and patterns")
  await user.click(bullet)
  await runNowFromKeyboard(user)
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  await runNowFromKeyboard(user)

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  expect(await within(panel).findByText(/Actionpad runtime is not running/i)).toBeInTheDocument()
  expect(within(panel).getByText("failed")).toBeInTheDocument()
})

test("opens a bullet chat side panel when a bullet starts running", async () => {
  const user = userEvent.setup()
  renderBlankApp()

  const bullet = await runBulletWithCmdEnter(user, "Find adjacent products and patterns")
  const request = getLastStartRunRequest(fetchMock)

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  expect(within(panel).getByRole("heading", { name: "Find adjacent products and patterns" }))
    .toBeInTheDocument()
  expect(within(panel).getByText("running")).toBeInTheDocument()
  expect(within(panel).getByText("Run ID")).toBeInTheDocument()
  expect(within(panel).getByText(`run-${request.nodeId}`)).toBeInTheDocument()
  expect(within(panel).getByText("user")).toBeInTheDocument()
  expect(within(panel).getByLabelText(/chat input/i)).toHaveAttribute(
    "placeholder",
    "Ask a follow-up...",
  )

  await user.click(within(panel).getByRole("button", { name: /close panel/i }))
  await waitFor(() =>
    expect(
      screen.queryByRole("complementary", { name: /bullet chat panel/i }),
    ).not.toBeInTheDocument(),
  )
  await waitFor(() => expect(bullet).toHaveFocus())
})

test("truncates long bullet chat titles", async () => {
  const user = userEvent.setup()
  renderBlankApp()

  const longPrompt =
    "Review the sidebar chat panel title behavior when the originating prompt is verbose enough to overflow the header"
  await runBulletWithCmdEnter(user, longPrompt)

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  expect(within(panel).getByRole("heading", { name: `${longPrompt.slice(0, 100)}...` }))
    .toBeInTheDocument()
  expect(within(panel).queryByRole("heading", { name: longPrompt })).not.toBeInTheDocument()
})

test("side panel width can be dragged wider from its left edge", async () => {
  const user = userEvent.setup()
  renderBlankApp()

  await runBulletWithCmdEnter(user, "Find adjacent products and patterns")

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  const resizeHandle = within(panel).getByRole("separator", { name: /resize side panel/i })

  fireEvent.mouseDown(resizeHandle, { clientX: 420 })
  fireEvent.mouseMove(window, { clientX: 360 })
  fireEvent.mouseUp(window)

  await waitFor(() => expect(panel).toHaveStyle({ width: "480px" }))
})

test("stop button cancels the active run from the chat panel", async () => {
  const user = userEvent.setup()
  renderBlankApp()

  await runBulletWithCmdEnter(user, "Find adjacent products and patterns")
  const request = getLastStartRunRequest(fetchMock)
  const runId = `run-${request.nodeId}`

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  await user.click(within(panel).getByRole("button", { name: /stop run/i }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenLastCalledWith(`http://127.0.0.1:43217/runs/${runId}/cancel`, {
      method: "POST",
    }),
  )
  await emitRuntimeEvent({
    type: "run-failed",
    runId,
    error: "Cancelled.",
    createdAt: 120,
  })

  expect(within(panel).getByText("failed")).toBeInTheDocument()
  expect(within(panel).getByText("Cancelled.")).toBeInTheDocument()
  expect(within(panel).queryByRole("button", { name: /stop run/i })).not.toBeInTheDocument()
})

test("does not show an external codex handoff for sdk threads", async () => {
  const user = userEvent.setup()
  renderBlankApp()

  const bullet = await prepareBullet(user, "Find adjacent products and patterns")
  await user.click(bullet)
  await runNowFromKeyboard(user)
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  const request = getLastStartRunRequest(fetchMock)
  await emitRuntimeEvent({
    type: "run-started",
    runId: `run-${request.nodeId}`,
    threadId: `thread-${request.nodeId}`,
    providerThreadId: "codex-thread-1",
    nodeId: request.nodeId,
    createdAt: 100,
  })
  await runNowFromKeyboard(user)

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  expect(within(panel).queryByRole("link", { name: /open in codex/i })).not.toBeInTheDocument()
  expect(
    within(panel).queryByRole("button", { name: /copy codex resume command/i }),
  ).not.toBeInTheDocument()
})

test("cmd enter opens the side panel for an already running bullet", async () => {
  const user = userEvent.setup()
  renderBlankApp()

  const bullet = await prepareBullet(user, "Find adjacent products and patterns")
  await user.click(bullet)
  await runNowFromKeyboard(user)
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  await emitRunStartedForLastRequest(fetchMock)

  expect(
    screen.queryByRole("complementary", { name: /bullet chat panel/i }),
  ).not.toBeInTheDocument()

  await user.keyboard("{Meta>}{Enter}{/Meta}")

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  expect(within(panel).getByRole("heading", { name: "Find adjacent products and patterns" }))
    .toBeInTheDocument()
  expect(screen.queryByText(/run after/i)).not.toBeInTheDocument()
  expect(screen.queryByText(/run at/i)).not.toBeInTheDocument()
})

test("cmd enter opens the side panel for a bullet with a completed run", async () => {
  const user = userEvent.setup()
  renderBlankApp()

  const bullet = await prepareBullet(user, "Find adjacent products and patterns")
  await user.click(bullet)
  await runNowFromKeyboard(user)
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  const request = await emitRunStartedForLastRequest(fetchMock)
  await emitRuntimeEvent({ type: "run-completed", runId: `run-${request.nodeId}`, createdAt: 120 })

  expect(
    screen.queryByRole("complementary", { name: /bullet chat panel/i }),
  ).not.toBeInTheDocument()

  await user.keyboard("{Meta>}{Enter}{/Meta}")

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  expect(within(panel).getByRole("heading", { name: "Find adjacent products and patterns" }))
    .toBeInTheDocument()
  expect(within(panel).getByText("succeeded")).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(screen.queryByText(/run after/i)).not.toBeInTheDocument()
  expect(screen.queryByText(/run at/i)).not.toBeInTheDocument()
})

test("open side panel shows the focused bullet chat when that bullet has a thread", async () => {
  const user = userEvent.setup()
  renderBlankApp()

  const firstBullet = await runBulletWithCmdEnter(user, "Find adjacent products and patterns")
  await user.click(firstBullet)
  await user.keyboard("{Enter}")
  const secondBullet = screen.getByLabelText(/bullet text: empty bullet/i)
  await user.type(secondBullet, "Sketch the first interaction loop")
  await user.click(secondBullet)
  await runNowFromKeyboard(user)
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  await emitRunStartedForLastRequest(fetchMock)
  await runNowFromKeyboard(user)

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  expect(within(panel).getByRole("heading", { name: "Sketch the first interaction loop" }))
    .toBeInTheDocument()

  await user.click(firstBullet)

  expect(within(panel).getByRole("heading", { name: "Find adjacent products and patterns" }))
    .toBeInTheDocument()
  expect(within(panel).queryByText("Sketch the first interaction loop")).not.toBeInTheDocument()
})

test("open side panel shows a quiet run invitation for a focused bullet with no thread", async () => {
  const user = userEvent.setup()
  renderBlankApp()

  const firstBullet = await runBulletWithCmdEnter(user, "Find adjacent products and patterns")
  await user.click(firstBullet)
  await user.keyboard("{Enter}")
  const threadlessBullet = screen.getByLabelText(/bullet text: empty bullet/i)
  await user.type(threadlessBullet, "Sketch the first interaction loop")

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  expect(within(panel).getByRole("heading", { name: "Sketch the first interaction loop" }))
    .toBeInTheDocument()
  expect(within(panel).getByText(/No chat yet/i)).toBeInTheDocument()
  expect(within(panel).queryByText(/Find adjacent products and patterns/)).not.toBeInTheDocument()

  await user.click(within(panel).getByRole("button", { name: /run this bullet/i }))

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  expect(fetchMock).toHaveBeenLastCalledWith(
    "http://127.0.0.1:43217/runs",
    expect.objectContaining({
      method: "POST",
      body: expect.stringContaining("Sketch the first interaction loop"),
    }),
  )
})

test("escape closes the open side panel and restores bullet focus", async () => {
  const user = userEvent.setup()
  renderBlankApp()

  const bullet = await runBulletWithCmdEnter(user, "Find adjacent products and patterns")
  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  await waitFor(() => expect(within(panel).getByLabelText(/chat input/i)).toHaveFocus())

  await user.keyboard("{Escape}")

  await waitFor(() =>
    expect(
      screen.queryByRole("complementary", { name: /bullet chat panel/i }),
    ).not.toBeInTheDocument(),
  )
  await waitFor(() => expect(bullet).toHaveFocus())
})

test("cmd enter starts the focused threadless bullet after another thread was selected", async () => {
  const user = userEvent.setup()
  renderBlankApp()

  const firstBullet = await runBulletWithCmdEnter(user, "Find adjacent products and patterns")

  const selectedThreadPanel = await screen.findByRole("complementary", {
    name: /bullet chat panel/i,
  })
  await user.click(within(selectedThreadPanel).getByRole("button", { name: /close panel/i }))
  await waitFor(() =>
    expect(
      screen.queryByRole("complementary", { name: /bullet chat panel/i }),
    ).not.toBeInTheDocument(),
  )
  await waitFor(() =>
    expect(screen.getByDisplayValue("Find adjacent products and patterns")).toHaveFocus(),
  )

  await user.keyboard("{Enter}")
  const threadlessBullet = screen.getByLabelText(/bullet text: empty bullet/i)
  await user.type(threadlessBullet, "Sketch the first interaction loop")
  await user.click(threadlessBullet)
  await runNowFromKeyboard(user)
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  await emitRunStartedForLastRequest(fetchMock)
  expect(
    screen.queryByRole("complementary", { name: /bullet chat panel/i }),
  ).not.toBeInTheDocument()
  await runNowFromKeyboard(user)

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  expect(within(panel).getByRole("heading", { name: "Sketch the first interaction loop" }))
    .toBeInTheDocument()
  expect(within(panel).queryByText(/Find adjacent products and patterns/)).not.toBeInTheDocument()
  expect(firstBullet).toBeInTheDocument()
})

test("chat input sends a follow-up after the current run completes", async () => {
  const user = userEvent.setup()
  renderBlankApp()

  await runBulletWithCmdEnter(user, "Find adjacent products and patterns")
  const request = getLastStartRunRequest(fetchMock)
  await emitRuntimeEvent({ type: "run-completed", runId: `run-${request.nodeId}`, createdAt: 120 })

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  const chatInput = within(panel).getByLabelText(/chat input/i)
  await user.type(chatInput, "Make this shorter")
  await user.click(within(panel).getByRole("button", { name: /send/i }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://127.0.0.1:43217/messages",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Make this shorter"),
      }),
    ),
  )
})

test("cmd enter in the chat input sends a follow-up", async () => {
  const user = userEvent.setup()
  renderBlankApp()

  await runBulletWithCmdEnter(user, "Find adjacent products and patterns")
  const request = getLastStartRunRequest(fetchMock)
  await emitRuntimeEvent({ type: "run-completed", runId: `run-${request.nodeId}`, createdAt: 120 })

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  const chatInput = within(panel).getByLabelText(/chat input/i)
  await user.type(chatInput, "Make this shorter")
  await user.keyboard("{Meta>}{Enter}{/Meta}")

  await waitFor(() =>
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://127.0.0.1:43217/messages",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Make this shorter"),
      }),
    ),
  )
})

test("follow-up user messages render after previous tool call groups", async () => {
  const user = userEvent.setup()
  renderBlankApp()

  await runBulletWithCmdEnter(user, "Find adjacent products and patterns")
  const request = getLastStartRunRequest(fetchMock)
  const runId = `run-${request.nodeId}`
  await emitRuntimeEvent({
    type: "tool-started",
    runId,
    toolCallId: "tool-1",
    name: "npm test",
    createdAt: 10_000,
  })
  await emitRuntimeEvent({
    type: "tool-completed",
    runId,
    toolCallId: "tool-1",
    name: "npm test",
    output: "passed",
    createdAt: 10_001,
  })
  await emitRuntimeEvent({ type: "run-completed", runId, createdAt: 10_002 })

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  const chatInput = within(panel).getByLabelText(/chat input/i)
  await user.type(chatInput, "Make this shorter")
  await user.click(within(panel).getByRole("button", { name: /send/i }))
  const followUpRequest = JSON.parse(fetchMock.mock.calls.at(-1)?.[1]?.body as string) as {
    nodeId: string
    threadId: string
    prompt: string
  }
  await emitRuntimeEvent({
    type: "run-started",
    runId: `run-${followUpRequest.nodeId}-follow-up`,
    threadId: followUpRequest.threadId,
    nodeId: followUpRequest.nodeId,
    prompt: followUpRequest.prompt,
    createdAt: 130,
  })

  const toolGroup = within(panel).getByText("1 tool call")
  const followUpMessage = within(panel).getByText("Make this shorter")
  expect(toolGroup.compareDocumentPosition(followUpMessage)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
})

test("cmd enter opens a thread and focuses the chat input", async () => {
  const user = userEvent.setup()
  renderBlankApp()

  await runBulletWithCmdEnter(user, "Sketch the first interaction loop")

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  const chatInput = within(panel).getByLabelText(/chat input/i)
  await waitFor(() => expect(chatInput).toHaveFocus())
  expect(within(panel).getByRole("heading", { name: "Sketch the first interaction loop" }))
    .toBeInTheDocument()
})

test("cmd left in the focused chat input leaves the side panel open", async () => {
  const user = userEvent.setup()
  renderBlankApp()

  await runBulletWithCmdEnter(user, "Sketch the first interaction loop")

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  const chatInput = within(panel).getByLabelText(/chat input/i)
  await waitFor(() => expect(chatInput).toHaveFocus())

  await user.keyboard("{Meta>}{ArrowLeft}{/Meta}")

  expect(screen.getByRole("complementary", { name: /bullet chat panel/i })).toBeInTheDocument()
  expect(chatInput).toHaveFocus()
})

test("cmd enter refocuses chat for an already selected open thread", async () => {
  const user = userEvent.setup()
  renderBlankApp()

  await runBulletWithCmdEnter(user, "Sketch the first interaction loop")
  const bullet = await prepareBullet(user, "Sketch the first interaction loop")

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  const chatInput = within(panel).getByLabelText(/chat input/i)
  await waitFor(() => expect(chatInput).toHaveFocus())

  await user.click(bullet)
  expect(bullet).toHaveFocus()

  await runNowFromKeyboard(user)

  await waitFor(() => expect(chatInput).toHaveFocus())
})

test("cmd left and cmd right on a focused bullet keep editor shortcuts available", async () => {
  const user = userEvent.setup()
  renderBlankApp()

  const bullet = await prepareBullet(user, "Sketch the first interaction loop")
  await user.click(bullet)
  await user.keyboard("{Meta>}{ArrowRight}{/Meta}")

  expect(screen.queryByRole("complementary", { name: /bullet chat panel/i })).not.toBeInTheDocument()
  expect(bullet).toHaveFocus()

  await runNowFromKeyboard(user)
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  await emitRunStartedForLastRequest(fetchMock)
  await runNowFromKeyboard(user)
  expect(
    await screen.findByRole("complementary", { name: /bullet chat panel/i }),
  ).toBeInTheDocument()
  await user.click(bullet)
  await user.keyboard("{Meta>}{ArrowLeft}{/Meta}")

  expect(screen.getByRole("complementary", { name: /bullet chat panel/i })).toBeInTheDocument()
  expect(bullet).toHaveFocus()
})

test("renders assistant message and outline output event after run completion", async () => {
  const user = userEvent.setup()
  renderBlankApp()

  await runBulletWithCmdEnter(user, "Find adjacent products and patterns")
  const request = getLastStartRunRequest(fetchMock)
  const runId = `run-${request.nodeId}`
  await emitRuntimeEvent({
    type: "assistant-message-started",
    runId,
    messageId: "message-1",
    createdAt: 110,
  })
  await emitRuntimeEvent({
    type: "assistant-delta",
    runId,
    messageId: "message-1",
    delta: "I drafted three outline bullets.",
    createdAt: 111,
  })
  await emitRuntimeEvent({
    type: "assistant-message-completed",
    runId,
    messageId: "message-1",
    createdAt: 112,
  })
  await emitRuntimeEvent({
    type: "outline-patch",
    runId,
    patch: {
      type: "append-child-bullets",
      parentId: request.nodeId,
      bullets: [
        { text: "Clarify the next action." },
        { text: "Identify the smallest useful test." },
        { text: "Note the follow-up decision." },
      ],
    },
    createdAt: 113,
  })
  await emitRuntimeEvent({ type: "run-completed", runId, createdAt: 114 })

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  await waitFor(() => expect(within(panel).getByText("assistant")).toBeInTheDocument())
  expect(within(panel).getByText("Outline output")).toBeInTheDocument()
  expect(within(panel).getByText("Appended 3 child bullets.")).toBeInTheDocument()
})

test("renders runtime tool and approval events", async () => {
  const user = userEvent.setup()
  renderBlankApp()

  await runBulletWithCmdEnter(user, "Find adjacent products and patterns")
  const request = getLastStartRunRequest(fetchMock)
  const runId = `run-${request.nodeId}`
  await emitRuntimeEvent({
    type: "tool-started",
    runId,
    toolCallId: "tool-1",
    name: "npm test",
    createdAt: 110,
  })
  await emitRuntimeEvent({
    type: "tool-completed",
    runId,
    toolCallId: "tool-1",
    name: "npm test",
    output: "passed",
    createdAt: 111,
  })
  await emitRuntimeEvent({
    type: "approval-requested",
    runId,
    approval: {
      id: "approval-1",
      runId,
      title: "Allow command",
      description: "Codex requested approval.",
      createdAt: 112,
    },
    createdAt: 112,
  })

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  expect(within(panel).queryByText("Tool started")).not.toBeInTheDocument()
  expect(within(panel).queryByText("Tool completed")).not.toBeInTheDocument()
  const toolGroup = within(panel).getByText("1 tool call").closest("details")
  expect(toolGroup).toBeInTheDocument()
  expect(within(toolGroup as HTMLElement).getByText("npm test")).not.toBeVisible()
  await user.click(within(panel).getByText("1 tool call"))
  expect(within(toolGroup as HTMLElement).getByText("npm test")).toBeVisible()
  expect(within(panel).getByText("Approval requested")).toBeInTheDocument()
  expect(within(panel).getByText("approval-1")).toBeInTheDocument()
})
