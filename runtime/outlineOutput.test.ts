// @vitest-environment node
import { describe, expect, it } from "vitest"
import { extractOutlinePatch, stripOutlineOutputBlocks } from "./outlineOutput"

describe("outlineOutput", () => {
  it("extracts append-child-bullets patch from Actionpad delimiters", () => {
    const patch = extractOutlinePatch(
      `
Here is my summary.
<actionpad-outline-output>
{ "type": "append-child-bullets", "parentId": "research-products", "bullets": [{ "text": "Compare Workflowy and Taskade." }] }
</actionpad-outline-output>
`,
      { expectedParentId: "research-products" },
    )

    expect(patch).toEqual({
      type: "append-child-bullets",
      parentId: "research-products",
      bullets: [{ text: "Compare Workflowy and Taskade." }],
    })
  })

  it("rejects missing Actionpad output blocks", () => {
    expect(extractOutlinePatch("No patch here.", { expectedParentId: "research-products" })).toEqual({
      error: "No Actionpad outline output block found.",
    })
  })

  it("returns a validation error for invalid JSON", () => {
    const patch = extractOutlinePatch(
      `<actionpad-outline-output>{ broken json }</actionpad-outline-output>`,
      { expectedParentId: "research-products" },
    )

    expect(patch).toEqual({ error: "Outline output block is not valid JSON." })
  })

  it("rejects patches that target a different parent", () => {
    const patch = extractOutlinePatch(
      `<actionpad-outline-output>
{ "type": "append-child-bullets", "parentId": "other-node", "bullets": [{ "text": "Wrong parent." }] }
</actionpad-outline-output>`,
      { expectedParentId: "research-products" },
    )

    expect(patch).toEqual({ error: "Outline output must target the executing bullet." })
  })

  it("returns a validation error for invalid patch JSON", () => {
    const patch = extractOutlinePatch(
      `
<actionpad-outline-output>
{ "type": "append-child-bullets", "parentId": "research-products", "bullets": [{ "text": "" }] }
</actionpad-outline-output>
`,
      { expectedParentId: "research-products" },
    )

    expect(patch).toEqual({ error: "Each appended bullet needs text." })
  })

  it("strips Actionpad output blocks from assistant text", () => {
    expect(
      stripOutlineOutputBlocks(`Before.
<actionpad-outline-output>
{ "type": "append-child-bullets", "parentId": "parent", "bullets": [{ "text": "Child." }] }
</actionpad-outline-output>
After.`),
    ).toBe("Before.\n\nAfter.")
  })
})
