import { execFile } from "node:child_process"
import { constants, type Dirent } from "node:fs"
import { access, lstat, open, readFile, readdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, isAbsolute, resolve } from "node:path"
import { promisify } from "node:util"
import type {
  BulletMention,
  FilesystemFolderInfoResponse,
  FilesystemEntry,
  FilesystemListResponse,
  FilesystemReadResponse,
} from "../src/domain/runtimeProtocol"

const execFileAsync = promisify(execFile)
const FILE_PREVIEW_LIMIT_BYTES = 50 * 1024
const FILE_READ_LIMIT_BYTES = 1024 * 1024
const FOLDER_ENTRY_LIMIT = 100

type ListFilesystemEntriesOptions = {
  path?: string | null
  workspace: string
  showHidden?: boolean
}

type BuildMentionContextOptions = {
  mentions: BulletMention[]
  workspace: string
}

type ReadTextFileOptions = {
  path: string
  workspace: string
}

type FolderPathOptions = {
  path: string
  workspace: string
}

function expandHome(input: string): string {
  if (input === "~") return homedir()
  if (input.startsWith("~/")) return resolve(homedir(), input.slice(2))
  return input
}

function normalizePath(input: string | null | undefined, workspace: string): string {
  const base = input?.trim() ? input : homedir()
  if (base.includes("\0")) {
    throw new Error("Path cannot contain null bytes.")
  }
  const expanded = expandHome(base)
  return isAbsolute(expanded) ? resolve(expanded) : resolve(workspace, expanded)
}

async function normalizeFolderPath(
  path: string | null | undefined,
  workspace: string,
): Promise<string> {
  const targetPath = normalizePath(path, workspace)
  const stats = await stat(targetPath)
  if (!stats.isDirectory()) {
    throw new Error("Path is not a folder.")
  }
  await access(targetPath, constants.R_OK)
  return targetPath
}

async function toEntry(parentPath: string, dirent: Dirent): Promise<FilesystemEntry | null> {
  let kind: FilesystemEntry["kind"] | null = null
  if (dirent.isDirectory()) kind = "folder"
  if (dirent.isFile()) kind = "file"
  if (!kind && dirent.isSymbolicLink()) {
    try {
      const targetStats = await stat(resolve(parentPath, dirent.name))
      if (targetStats.isDirectory()) kind = "folder"
      if (targetStats.isFile()) kind = "file"
    } catch {
      return null
    }
  }
  if (!kind) return null
  return {
    name: dirent.name,
    path: resolve(parentPath, dirent.name),
    kind,
  }
}

function compareEntries(a: FilesystemEntry, b: FilesystemEntry): number {
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1
  return a.name.localeCompare(b.name)
}

export async function listFilesystemEntries({
  path,
  workspace,
  showHidden = false,
}: ListFilesystemEntriesOptions): Promise<FilesystemListResponse> {
  const targetPath = await normalizeFolderPath(path, workspace)
  const dirents = await readdir(targetPath, { withFileTypes: true })
  const entries = (
    await Promise.all(
      dirents
        .filter((dirent) => showHidden || !dirent.name.startsWith("."))
        .map((dirent) => toEntry(targetPath, dirent)),
    )
  )
    .filter((entry): entry is FilesystemEntry => entry !== null)
    .sort(compareEntries)

  return {
    path: targetPath,
    parentPath: dirname(targetPath),
    entries,
  }
}

export async function getFilesystemFolderInfo({
  path,
  workspace,
}: FolderPathOptions): Promise<FilesystemFolderInfoResponse> {
  const targetPath = await normalizeFolderPath(path, workspace)
  let isGitRepoRoot = false

  try {
    const gitMetadata = await lstat(resolve(targetPath, ".git"))
    isGitRepoRoot = gitMetadata.isDirectory() || gitMetadata.isFile()
  } catch {
    isGitRepoRoot = false
  }

  return {
    path: targetPath,
    isGitRepoRoot,
  }
}

export async function openFolderInFinder({ path, workspace }: FolderPathOptions): Promise<void> {
  const targetPath = await normalizeFolderPath(path, workspace)
  await execFileAsync("open", [targetPath])
}

export async function readTextFile({
  path,
  workspace,
}: ReadTextFileOptions): Promise<FilesystemReadResponse> {
  const targetPath = normalizePath(path, workspace)
  const stats = await stat(targetPath)
  if (!stats.isFile()) {
    throw new Error("Path is not a file.")
  }
  if (stats.size > FILE_READ_LIMIT_BYTES) {
    throw new Error("File is too large to view.")
  }

  await access(targetPath, constants.R_OK)
  return {
    path: targetPath,
    content: await readFile(targetPath, "utf8"),
  }
}

async function previewFile(mention: BulletMention, workspace: string): Promise<string> {
  const targetPath = normalizePath(mention.path, workspace)
  const stats = await stat(targetPath)
  if (!stats.isFile()) return "  Warning: mentioned path is not a file."

  const file = await open(targetPath, "r")
  let preview = ""
  let truncated = false
  try {
    const buffer = Buffer.alloc(FILE_PREVIEW_LIMIT_BYTES + 1)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    truncated = stats.size > FILE_PREVIEW_LIMIT_BYTES || bytesRead > FILE_PREVIEW_LIMIT_BYTES
    preview = buffer.subarray(0, Math.min(bytesRead, FILE_PREVIEW_LIMIT_BYTES)).toString("utf8")
  } finally {
    await file.close()
  }
  return [
    "  File preview:",
    "  ```",
    preview.trimEnd(),
    truncated ? "  ...[truncated]" : "",
    "  ```",
  ]
    .filter(Boolean)
    .join("\n")
}

async function previewFolder(mention: BulletMention, workspace: string): Promise<string> {
  const listed = await listFilesystemEntries({ path: mention.path, workspace })
  const entries = listed.entries.slice(0, FOLDER_ENTRY_LIMIT)
  return [
    "  Folder entries:",
    ...entries.map((entry) => `  - ${entry.name}${entry.kind === "folder" ? "/" : ""}`),
    listed.entries.length > entries.length ? "  - ...[truncated]" : "",
  ]
    .filter(Boolean)
    .join("\n")
}

export async function buildMentionContext({
  mentions,
  workspace,
}: BuildMentionContextOptions): Promise<string> {
  if (mentions.length === 0) return ""

  const blocks = await Promise.all(
    mentions.map(async (mention) => {
      const header = `- ${mention.token} ${mention.path}`
      try {
        const preview =
          mention.kind === "folder"
            ? await previewFolder(mention, workspace)
            : await previewFile(mention, workspace)
        return `${header}\n${preview}`
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not read mentioned path."
        return `${header}\n  Warning: ${message}`
      }
    }),
  )

  return ["Mentioned filesystem context:", ...blocks].join("\n\n")
}
