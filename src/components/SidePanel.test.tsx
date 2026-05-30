import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { App } from "../App"

function rowForBullet(text: string): HTMLElement {
  const row = screen.getByDisplayValue(text).closest(".bullet-row")
  if (!(row instanceof HTMLElement)) {
    throw new Error(`Expected bullet row for ${text}`)
  }
  return row
}

test("opens a bullet chat side panel when a bullet starts running", async () => {
  const user = userEvent.setup()
  render(<App />)

  const targetRow = rowForBullet("Find adjacent products and patterns")
  await user.click(within(targetRow).getByRole("button", { name: /execute bullet/i }))

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
})
