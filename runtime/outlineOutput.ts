import type { OutlinePatch } from "../src/domain/runtimeProtocol"
import { validateOutlinePatch } from "../src/domain/runtimeProtocol"

type OutlinePatchResult = OutlinePatch | { error: string }
type ExtractOptions = { expectedParentId?: string }

const START = "<actionpad-outline-output>"
const END = "</actionpad-outline-output>"
const OUTPUT_BLOCK_PATTERN = /<actionpad-outline-output>[\s\S]*?<\/actionpad-outline-output>/g

function patchTargetsUnexpectedParent(patch: OutlinePatch, expectedParentId: string): boolean {
  switch (patch.type) {
    case "append-child-bullets":
      return patch.parentId !== expectedParentId
    case "batch":
      return patch.patches.some((childPatch) =>
        patchTargetsUnexpectedParent(childPatch, expectedParentId),
      )
    default:
      return false
  }
}

export function extractOutlinePatch(text: string, options: ExtractOptions = {}): OutlinePatchResult {
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
  const patch = parsed as OutlinePatch
  if (options.expectedParentId && patchTargetsUnexpectedParent(patch, options.expectedParentId)) {
    return { error: "Outline output must target the executing bullet." }
  }

  return patch
}

export function stripOutlineOutputBlocks(text: string): string {
  return text.replace(OUTPUT_BLOCK_PATTERN, "").trim()
}
