import { test, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const styles = readFileSync(join(process.cwd(), "src/styles.css"), "utf8")

test("task checkbox only indents the first visual line of bullet text", () => {
  expect(styles).toMatch(
    /\.bullet-content\.has-task-checkbox\s*{[^}]*position:\s*relative/,
  )
  expect(styles).toMatch(/\.task-checkbox-slot\s*{[^}]*position:\s*absolute/)
  expect(styles).toMatch(
    /\.bullet-content\.has-task-checkbox \.bullet-input,\s*\.bullet-content\.has-task-checkbox \.bullet-display\s*{[^}]*text-indent:\s*var\(--task-checkbox-offset\)/,
  )
  expect(styles).not.toMatch(
    /\.bullet-content\.has-task-checkbox\s*{[^}]*grid-template-columns:\s*18px\s+minmax\(0,\s*1fr\)/,
  )
  expect(styles).not.toMatch(
    /\.bullet-content\.has-task-checkbox \.bullet-input,\s*\.bullet-content\.has-task-checkbox \.bullet-display\s*{[^}]*grid-column:\s*2/,
  )
})

test("mention chips stay within the normal bullet text line height", () => {
  expect(styles).toMatch(/\.mention-chip\s*{[^}]*display:\s*inline-flex/)
  expect(styles).toMatch(/\.mention-chip\s*{[^}]*align-items:\s*center/)
  expect(styles).toMatch(/\.mention-chip\s*{[^}]*height:\s*1\.35em/)
  expect(styles).toMatch(/\.mention-chip\s*{[^}]*font-size:\s*0\.82em/)
  expect(styles).toMatch(/\.mention-chip\s*{[^}]*line-height:\s*1/)
  expect(styles).toMatch(/\.mention-chip\s*{[^}]*vertical-align:\s*baseline/)
})

test("collapsed rich markdown rows size to the visible display overlay", () => {
  expect(styles).toMatch(/\.bullet-content\s*{[^}]*position:\s*relative/)
  expect(styles).toMatch(
    /\.bullet-row:not\(\.is-focused\) \.bullet-input\.has-display-overlay\s*{[^}]*position:\s*absolute/,
  )
  expect(styles).toMatch(
    /\.bullet-row:not\(\.is-focused\) \.bullet-input\.has-display-overlay\s*{[^}]*pointer-events:\s*none/,
  )
})

test("long bullet text can scroll inside the row without expanding indefinitely", () => {
  expect(styles).toMatch(/\.bullet-input\s*{[^}]*max-height:\s*min\(42vh,\s*18lh\)/)
  expect(styles).toMatch(/\.bullet-input\s*{[^}]*overflow-y:\s*auto/)
  expect(styles).toMatch(/\.bullet-display\s*{[^}]*max-height:\s*min\(42vh,\s*18lh\)/)
  expect(styles).toMatch(/\.bullet-display\s*{[^}]*overflow-y:\s*auto/)
})
