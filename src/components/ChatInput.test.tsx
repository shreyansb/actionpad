import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { vi } from "vitest"
import { ChatInput } from "./ChatInput"

const originalScrollHeight = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  "scrollHeight",
)

afterEach(() => {
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
