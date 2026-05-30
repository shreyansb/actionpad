import type { BulletDraft } from "./types"

export type SimulatedOutput = {
  assistantMessage: string
  bullets: BulletDraft[]
}

export function createSimulatedOutput(context: string): SimulatedOutput {
  const lines = context
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  const focus = lines[lines.length - 1] ?? "this bullet"
  const project = lines[0] ?? "the project"

  return {
    assistantMessage:
      "I broke this into a few outline-ready notes and inserted them as child bullets.",
    bullets: [
      {
        text: `Clarify how "${focus}" supports ${project}.`,
        metadata: { source: "simulated-agent" },
      },
      {
        text: `List the smallest next observation needed for "${focus}".`,
        metadata: { source: "simulated-agent" },
      },
      {
        text: "Keep the generated output short enough to stay useful in the outline.",
        metadata: { source: "simulated-agent" },
      },
    ],
  }
}
