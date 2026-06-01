// @vitest-environment node
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { homedir, tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"
import { buildMentionContext, listFilesystemEntries, readTextFile } from "./filesystem"

let tempDir: string | null = null

async function makeTempWorkspace() {
  tempDir = await mkdtemp(join(tmpdir(), "actionpad-fs-"))
  return tempDir
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe("runtime filesystem helpers", () => {
  it("starts default browsing in the user home folder", async () => {
    const workspace = await makeTempWorkspace()

    const listed = await listFilesystemEntries({ workspace })

    expect(listed.path).toBe(homedir())
  })

  it("lists one readable folder level with folders before files and dotfiles hidden", async () => {
    const workspace = await makeTempWorkspace()
    await mkdir(join(workspace, "src"))
    await writeFile(join(workspace, "README.md"), "hello")
    await writeFile(join(workspace, ".env"), "secret")

    const listed = await listFilesystemEntries({ path: workspace, workspace })

    expect(listed).toEqual({
      path: workspace,
      parentPath: expect.any(String),
      entries: [
        { name: "src", path: join(workspace, "src"), kind: "folder" },
        { name: "README.md", path: join(workspace, "README.md"), kind: "file" },
      ],
    })
  })

  it("includes symlinks that resolve to folders", async () => {
    const workspace = await makeTempWorkspace()
    await mkdir(join(workspace, "real-folder"))
    await writeFile(join(workspace, "real-folder", "inside.txt"), "hello")
    await symlink(join(workspace, "real-folder"), join(workspace, "LinkedFolder"))

    const listed = await listFilesystemEntries({ path: workspace, workspace })

    expect(listed.entries).toContainEqual({
      name: "LinkedFolder",
      path: join(workspace, "LinkedFolder"),
      kind: "folder",
    })

    const linked = await listFilesystemEntries({ path: join(workspace, "LinkedFolder"), workspace })

    expect(linked.entries).toContainEqual({
      name: "inside.txt",
      path: join(workspace, "LinkedFolder", "inside.txt"),
      kind: "file",
    })
  })

  it("builds bounded context for mentioned files and folders without failing on unreadable paths", async () => {
    const workspace = await makeTempWorkspace()
    await mkdir(join(workspace, "src"))
    await writeFile(join(workspace, "src", "App.tsx"), "export function App() { return null }\n")
    await writeFile(join(workspace, "README.md"), "Actionpad notes\n")

    const context = await buildMentionContext({
      workspace,
      mentions: [
        {
          id: "mention-file",
          kind: "file",
          path: join(workspace, "README.md"),
          label: "README.md",
          token: "@README.md",
          createdAt: 100,
        },
        {
          id: "mention-folder",
          kind: "folder",
          path: join(workspace, "src"),
          label: "src",
          token: "@src",
          createdAt: 101,
        },
        {
          id: "missing-file",
          kind: "file",
          path: join(workspace, "missing.md"),
          label: "missing.md",
          token: "@missing.md",
          createdAt: 102,
        },
      ],
    })

    expect(context).toContain("Mentioned filesystem context:")
    expect(context).toContain("- @README.md ")
    expect(context).toContain("Actionpad notes")
    expect(context).toContain("- @src ")
    expect(context).toContain("Folder entries:")
    expect(context).toContain("App.tsx")
    expect(context).toContain("Warning:")
    expect(context).toContain("missing.md")
  })

  it("reads markdown file content for the document viewer", async () => {
    const workspace = await makeTempWorkspace()
    const planPath = join(workspace, "docs", "plan.md")
    await mkdir(join(workspace, "docs"))
    await writeFile(planPath, "# Plan\n\nShip it.\n")

    const file = await readTextFile({ path: planPath, workspace })

    expect(file).toEqual({
      path: planPath,
      content: "# Plan\n\nShip it.\n",
    })
  })

  it("reads relative markdown paths from the workspace", async () => {
    const workspace = await makeTempWorkspace()
    const docsPath = join(workspace, "docs")
    await mkdir(docsPath)
    await writeFile(join(docsPath, "plan.md"), "# Workspace plan\n")

    const file = await readTextFile({ path: "docs/plan.md", workspace })

    expect(file).toEqual({
      path: join(docsPath, "plan.md"),
      content: "# Workspace plan\n",
    })
  })
})
