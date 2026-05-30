import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { App } from "../App"

test("renders visible outline rows and edits bullet text", async () => {
  const user = userEvent.setup()
  render(<App />)

  const bullet = screen.getByDisplayValue("Find adjacent products and patterns")

  expect(screen.getByLabelText("Executable outline")).toBeInTheDocument()
  expect(screen.getByDisplayValue("Executable Outliner Prototype")).toBeInTheDocument()

  await user.clear(bullet)
  await user.type(bullet, "Map editor interactions")

  expect(screen.getByDisplayValue("Map editor interactions")).toBeInTheDocument()
})
