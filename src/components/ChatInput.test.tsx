import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { vi } from "vitest"
import { ChatInput } from "./ChatInput"

const originalScrollHeight = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  "scrollHeight",
)

afterEach(() => {
  window.localStorage.clear()
  if (originalScrollHeight) {
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", originalScrollHeight)
  }
})

test("grows the chat input with its text and shrinks after submit", async () => {
  const user = userEvent.setup()
  const onSubmit = vi.fn()
  Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return this.value.includes("\n") ? 112 : 40
    },
  })

  render(<ChatInput autoFocusKey={null} onSubmit={onSubmit} />)

  const chatInput = screen.getByLabelText(/chat input/i)
  expect(chatInput).toHaveStyle({ height: "40px" })

  fireEvent.change(chatInput, { target: { value: "Line one\nLine two" } })

  expect(chatInput).toHaveStyle({ height: "112px" })

  await user.click(screen.getByRole("button", { name: /send/i }))

  expect(onSubmit).toHaveBeenCalledWith("Line one\nLine two")
  expect(chatInput).toHaveStyle({ height: "40px" })
})

test("keeps separate local drafts for each bullet and clears them after submit", async () => {
  const user = userEvent.setup()
  const onSubmit = vi.fn()
  const { rerender } = render(
    <ChatInput autoFocusKey={null} draftKey="node-1" onSubmit={onSubmit} />,
  )

  await user.type(screen.getByLabelText(/chat input/i), "Draft for first bullet")

  rerender(<ChatInput autoFocusKey={null} draftKey="node-2" onSubmit={onSubmit} />)
  expect(screen.getByLabelText(/chat input/i)).toHaveValue("")

  await user.type(screen.getByLabelText(/chat input/i), "Draft for second bullet")

  rerender(<ChatInput autoFocusKey={null} draftKey="node-1" onSubmit={onSubmit} />)
  expect(screen.getByLabelText(/chat input/i)).toHaveValue("Draft for first bullet")

  await user.click(screen.getByRole("button", { name: /send/i }))
  expect(onSubmit).toHaveBeenCalledWith("Draft for first bullet")
  expect(window.localStorage.getItem("actionpad:chat-draft:node-1")).toBeNull()

  rerender(<ChatInput autoFocusKey={null} draftKey="node-2" onSubmit={onSubmit} />)
  expect(screen.getByLabelText(/chat input/i)).toHaveValue("Draft for second bullet")
})
