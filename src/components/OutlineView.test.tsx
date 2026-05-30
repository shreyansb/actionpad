import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { act } from "react"
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

function rowForBullet(text: string): HTMLElement {
  const row = screen.getByDisplayValue(text).closest(".bullet-row")
  if (!(row instanceof HTMLElement)) {
    throw new Error(`Expected bullet row for ${text}`)
  }
  return row
}

test("renders visible outline rows and edits bullet text", async () => {
  const user = userEvent.setup()
  render(<App />)

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

test("enter creates a new row and moves focus to the new input", async () => {
  const user = userEvent.setup()
  render(<App />)

  const bullet = screen.getByDisplayValue("Find adjacent products and patterns")
  await user.click(bullet)
  await user.keyboard("{Enter}")

  await waitFor(() => expect(document.activeElement).toHaveValue(""))
  expect(screen.getAllByDisplayValue("")).toHaveLength(1)
})

test("backspace on an empty bullet deletes it and focuses the previous visible bullet", async () => {
  const user = userEvent.setup()
  render(<App />)

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
  render(<App />)

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
  render(<App />)

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
  render(<App />)

  const leafRow = rowForBullet("Find adjacent products and patterns")

  expect(within(leafRow).queryByRole("button", { name: /collapse bullet/i })).not.toBeInTheDocument()
  expect(within(leafRow).getByText("•")).toHaveAttribute("aria-hidden", "true")
})

test("leaf row exposes a pointer drag handle outside the keyboard tab order", () => {
  render(<App />)

  const leafRow = rowForBullet("Find adjacent products and patterns")
  const dragHandle = within(leafRow).getByLabelText("Drag bullet")

  expect(dragHandle).toHaveAttribute("tabindex", "-1")
  expect(within(leafRow).getByText("•")).toHaveAttribute("aria-hidden", "true")
})

test("parent disclosure button remains in the keyboard tab order", () => {
  render(<App />)

  const parentRow = rowForBullet("Research")
  const disclosureButton = within(parentRow).getByRole("button", { name: /collapse bullet/i })

  expect(disclosureButton).not.toHaveAttribute("tabindex", "-1")
})

test("clicking the drag handle focuses its row", async () => {
  const user = userEvent.setup()
  render(<App />)

  const leafRow = rowForBullet("Find adjacent products and patterns")
  const otherInput = screen.getByDisplayValue("Actionpad Prototype")

  await user.click(otherInput)
  expect(leafRow).not.toHaveClass("is-focused")

  await user.click(within(leafRow).getByLabelText("Drag bullet"))

  await waitFor(() => expect(leafRow).toHaveClass("is-focused"))
})

test("focusing a chat row control focuses the row", async () => {
  const user = userEvent.setup()
  render(<App />)

  const leafRow = rowForBullet("Find adjacent products and patterns")
  const sourceInput = screen.getByDisplayValue("Find adjacent products and patterns")
  fireEvent.keyDown(sourceInput, { key: "Enter", metaKey: true })
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

test("generated rows use quieter text without row controls or labels", async () => {
  render(<App />)

  expect(screen.queryByRole("button", { name: /execute bullet/i })).not.toBeInTheDocument()

  const sourceInput = screen.getByDisplayValue("Find adjacent products and patterns")
  fireEvent.keyDown(sourceInput, { key: "Enter", metaKey: true })
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

test("plain arrow navigation moves focus to the adjacent visible bullet editor", async () => {
  const user = userEvent.setup()
  render(<App />)

  const current = screen.getByDisplayValue("Find adjacent products and patterns")
  await user.click(current)
  await user.keyboard("{ArrowDown}")

  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByDisplayValue("Sketch the first interaction loop"),
    ),
  )
})

test("shift arrow selection stays inside the focused bullet editor", async () => {
  const user = userEvent.setup()
  render(<App />)

  const current = screen.getByDisplayValue("Find adjacent products and patterns") as HTMLTextAreaElement
  await user.click(current)
  current.setSelectionRange(0, 0)

  const nativeSelectionHandled = fireEvent.keyDown(current, { key: "ArrowRight", shiftKey: true })

  expect(nativeSelectionHandled).toBe(true)
  expect(document.activeElement).toBe(current)
})

test("shift enter inserts a newline inside the focused bullet editor", async () => {
  const user = userEvent.setup()
  render(<App />)

  const current = screen.getByDisplayValue("Find adjacent products and patterns") as HTMLTextAreaElement
  await user.click(current)
  current.setSelectionRange(4, 4)

  await user.keyboard("{Shift>}{Enter}{/Shift}")

  expect(current).toHaveValue("Find\n adjacent products and patterns")
  expect(screen.queryByDisplayValue("")).not.toBeInTheDocument()
})

test("option arrow reorders a bullet within its siblings", async () => {
  const user = userEvent.setup()
  render(<App />)

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
