import { render, screen } from "@testing-library/react"
import { App } from "./App"
import { createSeededOutlineState } from "./domain/fixtures"

test("renders the Theolabs branding below the outline pane", () => {
  const { container } = render(<App initialState={createSeededOutlineState()} />)

  const branding = container.querySelector(".app-branding")
  const outline = container.querySelector(".outline")
  expect(branding).not.toBeNull()
  expect(outline).not.toBeNull()
  if (!branding || !outline) throw new Error("Expected branding and outline to render.")
  expect(container.querySelector(".outline-pane > .app-branding")).toBe(branding)
  expect(outline.compareDocumentPosition(branding)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  )
  expect(
    screen.getByRole("link", { name: "shreyans bhansali // theolabs, 2026" }),
  ).toHaveAttribute(
    "href",
    "https://www.theolabs.org",
  )
})
