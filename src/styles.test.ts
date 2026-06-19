import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const stylesPath = join(dirname(fileURLToPath(import.meta.url)), "styles.css")
const styles = readFileSync(stylesPath, "utf8")

test("uses warm gray for the page background", () => {
  expect(styles).toMatch(/:root\s*{[^}]*background:\s*#f3f0e8;/s)
  expect(styles).toMatch(/\.app-shell\s*{[^}]*background:\s*#f3f0e8;/s)
})
