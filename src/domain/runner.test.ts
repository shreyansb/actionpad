import { describe, expect, it } from "vitest"
import { createSimulatedOutput } from "./runner"

describe("createSimulatedOutput", () => {
  it("creates deterministic child bullet drafts for a prompt", () => {
    expect(createSimulatedOutput("Project\nResearch\nFind adjacent products")).toEqual({
      assistantMessage:
        "I broke this into a few outline-ready notes and inserted them as child bullets.",
      bullets: [
        {
          text: 'Clarify how "Find adjacent products" supports Project.',
          metadata: { source: "simulated-agent" },
        },
        {
          text: 'List the smallest next observation needed for "Find adjacent products".',
          metadata: { source: "simulated-agent" },
        },
        {
          text: "Keep the generated output short enough to stay useful in the outline.",
          metadata: { source: "simulated-agent" },
        },
      ],
    })
  })
})
