import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ChatThreadView } from "./ChatThreadView"
import type { AgentEvent, AgentMessage } from "../domain/types"

test("groups consecutive tool events into separate collapsed sections", async () => {
  const user = userEvent.setup()
  const events: AgentEvent[] = [
    {
      type: "tool-completed",
      toolCallId: "tool-1",
      name: "npm test",
      output: "passed",
      createdAt: 100,
    },
    {
      type: "tool-completed",
      toolCallId: "tool-2",
      name: "npm run lint",
      output: "passed",
      createdAt: 101,
    },
    {
      type: "tool-started",
      toolCallId: "tool-3",
      name: "npm run typecheck",
      createdAt: 103,
    },
    {
      type: "outline-output",
      output: {
        type: "append-child-bullets",
        parentId: "node-1",
        bullets: [{ text: "Implemented the display change." }],
      },
      createdAt: 104,
    },
    {
      type: "tool-started",
      toolCallId: "tool-4",
      name: "npm run build",
      createdAt: 105,
    },
  ]
  const messages: AgentMessage[] = [
    {
      id: "assistant-1",
      role: "assistant",
      content: "I found a first issue.",
      createdAt: 102,
      status: "complete",
    },
  ]

  render(<ChatThreadView messages={messages} events={events} />)

  expect(screen.queryByText("Tool completed")).not.toBeInTheDocument()
  expect(screen.queryByText("Tool started")).not.toBeInTheDocument()
  expect(screen.getByText("I found a first issue.")).toBeInTheDocument()
  expect(screen.getByText("Outline output")).toBeInTheDocument()

  const firstGroup = screen.getByText("2 tool calls").closest("details")
  const singleGroups = screen.getAllByText("1 tool call").map((summary) => summary.closest("details"))
  expect(firstGroup).toBeInTheDocument()
  expect(singleGroups).toHaveLength(2)
  expect(firstGroup).not.toHaveAttribute("open")
  expect(singleGroups[0]).not.toHaveAttribute("open")
  expect(singleGroups[1]).not.toHaveAttribute("open")
  expect(within(firstGroup as HTMLElement).getByText("npm test")).not.toBeVisible()
  expect(within(singleGroups[0] as HTMLElement).getByText("npm run typecheck")).not.toBeVisible()
  expect(within(singleGroups[1] as HTMLElement).getByText("npm run build")).not.toBeVisible()

  await user.click(screen.getByText("2 tool calls"))

  expect(within(firstGroup as HTMLElement).getByText("npm test")).toBeVisible()
  expect(within(firstGroup as HTMLElement).getByText("npm run lint")).toBeVisible()
  expect(within(singleGroups[0] as HTMLElement).getByText("npm run typecheck")).not.toBeVisible()
  expect(within(singleGroups[1] as HTMLElement).getByText("npm run build")).not.toBeVisible()
})
