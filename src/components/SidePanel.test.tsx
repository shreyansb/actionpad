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

test("shows empty state for a focused threadless bullet after another thread was selected", async () => {
  const user = userEvent.setup()
  render(<App />)

  const threadedRow = rowForBullet("Find adjacent products and patterns")
  await user.click(within(threadedRow).getByRole("button", { name: /execute bullet/i }))

  const selectedThreadPanel = await screen.findByRole("complementary", {
    name: /bullet chat panel/i,
  })
  await user.click(within(selectedThreadPanel).getByRole("button", { name: /close panel/i }))

  const threadlessBullet = screen.getByDisplayValue("Sketch the first interaction loop")
  await user.click(threadlessBullet)
  await user.keyboard("{Meta>}{ArrowRight}{/Meta}")

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  expect(within(panel).getByRole("heading", { name: "Sketch the first interaction loop" }))
    .toBeInTheDocument()
  expect(
    within(panel).getByText("Execute this bullet to create its chat thread."),
  ).toBeInTheDocument()
  expect(within(panel).queryByText(/Find adjacent products and patterns/)).not.toBeInTheDocument()
})

test("renders chat input as readonly while chat submit stays inert", async () => {
  const user = userEvent.setup()
  render(<App />)

  const targetRow = rowForBullet("Find adjacent products and patterns")
  await user.click(within(targetRow).getByRole("button", { name: /execute bullet/i }))

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  expect(within(panel).getByLabelText(/chat input/i)).toHaveAttribute("readonly")
  expect(within(panel).getByLabelText(/chat input/i)).not.toBeDisabled()
  expect(within(panel).getByRole("button", { name: /send/i })).toBeDisabled()
})

test("cmd enter opens a thread and focuses the readonly chat input", async () => {
  const user = userEvent.setup()
  render(<App />)

  const bullet = screen.getByDisplayValue("Sketch the first interaction loop")
  await user.click(bullet)
  await user.keyboard("{Meta>}{Enter}{/Meta}")

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  const chatInput = within(panel).getByLabelText(/chat input/i)
  await waitFor(() => expect(chatInput).toHaveFocus())
  expect(within(panel).getByRole("heading", { name: "Sketch the first interaction loop" }))
    .toBeInTheDocument()
})

test("cmd left from the focused chat input closes the side panel and returns focus to the bullet", async () => {
  const user = userEvent.setup()
  render(<App />)

  const bullet = screen.getByDisplayValue("Sketch the first interaction loop")
  await user.click(bullet)
  await user.keyboard("{Meta>}{Enter}{/Meta}")

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  const chatInput = within(panel).getByLabelText(/chat input/i)
  await waitFor(() => expect(chatInput).toHaveFocus())

  await user.keyboard("{Meta>}{ArrowLeft}{/Meta}")

  await waitFor(() =>
    expect(
      screen.queryByRole("complementary", { name: /bullet chat panel/i }),
    ).not.toBeInTheDocument(),
  )
  await waitFor(() => expect(bullet).toHaveFocus())
})

test("cmd enter refocuses chat for an already selected open thread", async () => {
  const user = userEvent.setup()
  render(<App />)

  const bullet = screen.getByDisplayValue("Sketch the first interaction loop")
  await user.click(bullet)
  await user.keyboard("{Meta>}{Enter}{/Meta}")

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  const chatInput = within(panel).getByLabelText(/chat input/i)
  await waitFor(() => expect(chatInput).toHaveFocus())

  await user.click(bullet)
  expect(bullet).toHaveFocus()

  await user.keyboard("{Meta>}{Enter}{/Meta}")

  await waitFor(() => expect(chatInput).toHaveFocus())
})

test("cmd left closes the side panel from a focused bullet", async () => {
  const user = userEvent.setup()
  render(<App />)

  const bullet = screen.getByDisplayValue("Sketch the first interaction loop")
  await user.click(bullet)
  await user.keyboard("{Meta>}{ArrowRight}{/Meta}")

  expect(await screen.findByRole("complementary", { name: /bullet chat panel/i })).toBeInTheDocument()

  await user.keyboard("{Meta>}{ArrowLeft}{/Meta}")

  await waitFor(() =>
    expect(
      screen.queryByRole("complementary", { name: /bullet chat panel/i }),
    ).not.toBeInTheDocument(),
  )
})

test("renders assistant message and outline output event after run completion", async () => {
  const user = userEvent.setup()
  render(<App />)

  const targetRow = rowForBullet("Find adjacent products and patterns")
  await user.click(within(targetRow).getByRole("button", { name: /execute bullet/i }))

  const panel = await screen.findByRole("complementary", { name: /bullet chat panel/i })
  await waitFor(() => expect(within(panel).getByText("assistant")).toBeInTheDocument())
  expect(within(panel).getByText("Outline output")).toBeInTheDocument()
  expect(within(panel).getByText("Appended 3 child bullets.")).toBeInTheDocument()
})
