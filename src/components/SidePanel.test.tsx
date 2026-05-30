import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, vi } from "vitest"
import { App } from "../App"
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

async function runBulletWithCmdEnter(user: ReturnType<typeof userEvent.setup>, text: string) {
  const bullet = screen.getByDisplayValue(text)
  await user.click(bullet)
  await user.keyboard("{Meta>}{Enter}{/Meta}")
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  await emitRunStartedForLastRequest(fetchMock)
  return bullet
}

test("cmd enter sends focused bullet context to the runtime", async () => {
  const user = userEvent.setup()
  render(<App />)

  const bullet = screen.getByDisplayValue("Find adjacent products and patterns")
  await user.click(bullet)
  await user.keyboard("{Meta>}{Enter}{/Meta}")

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43217/runs",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Actionpad Prototype"),
      }),
    ),
  )
  expect(
    await screen.findByRole("complementary", { name: /bullet chat panel/i }),
  ).toBeInTheDocument()
})

test("runtime startup failure marks the bullet failed with a useful message", async () => {
  const user = userEvent.setup()
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:43217")),
  )
  render(<App />)

  const bullet = screen.getByDisplayValue("Find adjacent products and patterns")
  await user.click(bullet)
  await user.keyboard("{Meta>}{Enter}{/Meta}")

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  expect(await within(panel).findByText(/Actionpad runtime is not running/i)).toBeInTheDocument()
  expect(within(panel).getByText("failed")).toBeInTheDocument()
})

test("opens a bullet chat side panel when a bullet starts running", async () => {
  const user = userEvent.setup()
  render(<App />)

  const bullet = await runBulletWithCmdEnter(user, "Find adjacent products and patterns")

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  expect(within(panel).getByRole("heading", { name: "Find adjacent products and patterns" }))
    .toBeInTheDocument()
  expect(within(panel).getByText("running")).toBeInTheDocument()
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

test("cmd enter starts the focused threadless bullet after another thread was selected", async () => {
  const user = userEvent.setup()
  render(<App />)

  await runBulletWithCmdEnter(user, "Find adjacent products and patterns")

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

  const threadlessBullet = screen.getByDisplayValue("Sketch the first interaction loop")
  await user.click(threadlessBullet)
  await user.keyboard("{Meta>}{Enter}{/Meta}")
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  await emitRunStartedForLastRequest(fetchMock)

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  expect(within(panel).getByRole("heading", { name: "Sketch the first interaction loop" }))
    .toBeInTheDocument()
  expect(within(panel).queryByText(/Find adjacent products and patterns/)).not.toBeInTheDocument()
})

test("renders chat input as readonly while chat submit stays inert", async () => {
  const user = userEvent.setup()
  render(<App />)

  await runBulletWithCmdEnter(user, "Find adjacent products and patterns")

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  expect(within(panel).getByLabelText(/chat input/i)).toHaveAttribute("readonly")
  expect(within(panel).getByLabelText(/chat input/i)).not.toBeDisabled()
  expect(within(panel).getByRole("button", { name: /send/i })).toBeDisabled()
})

test("cmd enter opens a thread and focuses the readonly chat input", async () => {
  const user = userEvent.setup()
  render(<App />)

  await runBulletWithCmdEnter(user, "Sketch the first interaction loop")

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  const chatInput = within(panel).getByLabelText(/chat input/i)
  await waitFor(() => expect(chatInput).toHaveFocus())
  expect(within(panel).getByRole("heading", { name: "Sketch the first interaction loop" }))
    .toBeInTheDocument()
})

test("cmd left in the focused chat input leaves the side panel open", async () => {
  const user = userEvent.setup()
  render(<App />)

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
  render(<App />)

  await runBulletWithCmdEnter(user, "Sketch the first interaction loop")
  const bullet = screen.getByDisplayValue("Sketch the first interaction loop")

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  const chatInput = within(panel).getByLabelText(/chat input/i)
  await waitFor(() => expect(chatInput).toHaveFocus())

  await user.click(bullet)
  expect(bullet).toHaveFocus()

  await user.keyboard("{Meta>}{Enter}{/Meta}")

  await waitFor(() => expect(chatInput).toHaveFocus())
})

test("cmd left and cmd right on a focused bullet keep editor shortcuts available", async () => {
  const user = userEvent.setup()
  render(<App />)

  const bullet = screen.getByDisplayValue("Sketch the first interaction loop")
  await user.click(bullet)
  await user.keyboard("{Meta>}{ArrowRight}{/Meta}")

  expect(screen.queryByRole("complementary", { name: /bullet chat panel/i })).not.toBeInTheDocument()
  expect(bullet).toHaveFocus()

  await user.keyboard("{Meta>}{Enter}{/Meta}")
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
  render(<App />)

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
  render(<App />)

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
  expect(within(panel).getByText("Tool started")).toBeInTheDocument()
  expect(within(panel).getByText("Tool completed")).toBeInTheDocument()
  expect(within(panel).getByText("Approval requested")).toBeInTheDocument()
  expect(within(panel).getByText("approval-1")).toBeInTheDocument()
})
