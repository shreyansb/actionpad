// @vitest-environment node
import { describe, expect, it } from "vitest"
import { extractOutlinePatch } from "./outlineOutput"

describe("outlineOutput", () => {
  it("extracts append-child-bullets patch from Actionpad delimiters", () => {
    const patch = extractOutlinePatch(`
Here is my summary.
<actionpad-outline-output>
{ "type": "append-child-bullets", "parentId": "research-products", "bullets": [{ "text": "Compare Workflowy and Taskade." }] }
</actionpad-outline-output>
`)

    expect(patch).toEqual({
      type: "append-child-bullets",
      parentId: "research-products",
      bullets: [{ text: "Compare Workflowy and Taskade." }],
    })
  })

  it("returns a validation error for invalid patch JSON", () => {
    const patch = extractOutlinePatch(`
<actionpad-outline-output>
{ "type": "append-child-bullets", "parentId": "research-products", "bullets": [{ "text": "" }] }
</actionpad-outline-output>
`)

    expect(patch).toEqual({ error: "Each appended bullet needs text." })
  })
})
