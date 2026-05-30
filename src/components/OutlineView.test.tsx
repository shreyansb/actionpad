import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { act } from "react"
import { App } from "../App"

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
  expect(screen.getByDisplayValue("Executable Outliner Prototype")).toBeInTheDocument()
  expect(
    screen.getByRole("textbox", { name: /bullet text: executable outliner prototype/i }),
  ).toHaveValue("Executable Outliner Prototype")

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
  const otherInput = screen.getByDisplayValue("Executable Outliner Prototype")

  await user.click(otherInput)
  expect(leafRow).not.toHaveClass("is-focused")

  await user.click(within(leafRow).getByLabelText("Drag bullet"))

  await waitFor(() => expect(leafRow).toHaveClass("is-focused"))
})

test("focusing a row control focuses the row", async () => {
  const user = userEvent.setup()
  render(<App />)

  const leafRow = rowForBullet("Find adjacent products and patterns")

  const executeButton = within(leafRow).getByRole("button", { name: /execute bullet/i })
  await user.click(screen.getByDisplayValue("Executable Outliner Prototype"))
  expect(leafRow).not.toHaveClass("is-focused")
  expect(executeButton).toHaveAttribute("tabindex", "-1")

  await act(async () => {
    executeButton.focus()
  })

  await waitFor(() => expect(leafRow).toHaveClass("is-focused"))
  expect(executeButton).toHaveAttribute("tabindex", "0")
})

test("generated rows keep the execute control alongside generated status", async () => {
  const user = userEvent.setup()
  render(<App />)

  const sourceRow = rowForBullet("Find adjacent products and patterns")
  await user.click(within(sourceRow).getByRole("button", { name: /execute bullet/i }))

  const generatedInput = await screen.findByDisplayValue(
    'Clarify how "Find adjacent products and patterns" supports Executable Outliner Prototype.',
    {},
    { timeout: 1500 },
  )
  const generatedRow = generatedInput.closest(".bullet-row")

  expect(generatedRow).toHaveClass("is-generated")
  expect(within(generatedRow as HTMLElement).getByText("generated")).toBeInTheDocument()
  expect(
    within(generatedRow as HTMLElement).getByRole("button", { name: /execute bullet/i }),
  ).toBeInTheDocument()
})

test("plain arrow navigation stays inside the focused bullet editor", async () => {
  const user = userEvent.setup()
  render(<App />)

  const current = screen.getByDisplayValue("Find adjacent products and patterns")
  await user.click(current)
  await user.keyboard("{ArrowDown}")

  expect(document.activeElement).toBe(current)
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
    "Executable Outliner Prototype",
    "Sketch the first interaction loop",
    "Research",
    "Find adjacent products and patterns",
  ])
  expect(document.activeElement).toBe(screen.getByDisplayValue("Sketch the first interaction loop"))
})
