import { render, screen } from "@testing-library/react"
import { App } from "./App"
import { createSeededOutlineState } from "./domain/fixtures"

test("renders the Theolabs branding aligned with the outline pane", () => {
  const { container } = render(<App initialState={createSeededOutlineState()} />)

  const branding = container.querySelector(".app-branding")
  expect(branding).not.toBeNull()
  expect(container.querySelector(".outline-pane > .app-branding")).toBe(branding)
  expect(screen.getByText(/made by shreyans @/i)).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "theolabs.org" })).toHaveAttribute(
    "href",
    "https://theolabs.org",
  )
})
