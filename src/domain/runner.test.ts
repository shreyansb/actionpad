import { describe, expect, it } from "vitest"
import { createSimulatedOutput } from "./runner"

describe("createSimulatedOutput", () => {
  it("creates deterministic child bullet drafts for a prompt", () => {
    const output = createSimulatedOutput("Project\nResearch\nFind adjacent products")
    expect(output.assistantMessage).toContain("I broke this into a few outline-ready notes")
    expect(output.bullets).toHaveLength(3)
    expect(output.bullets[0].text).toContain("Project")
    expect(output.bullets[0].metadata?.source).toBe("simulated-agent")
  })
})
