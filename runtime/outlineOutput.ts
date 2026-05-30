import type { OutlinePatch } from "../src/domain/runtimeProtocol"
import { validateOutlinePatch } from "../src/domain/runtimeProtocol"

type OutlinePatchResult = OutlinePatch | { error: string }

const START = "<actionpad-outline-output>"
const END = "</actionpad-outline-output>"

export function extractOutlinePatch(text: string): OutlinePatchResult {
  const start = text.indexOf(START)
  const end = text.indexOf(END)
  if (start === -1 || end === -1 || end <= start) {
    return { error: "No Actionpad outline output block found." }
  }

  const json = text.slice(start + START.length, end).trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { error: "Outline output block is not valid JSON." }
  }

  const validation = validateOutlinePatch(parsed)
  if (!validation.ok) return { error: validation.error }
  return parsed as OutlinePatch
}
