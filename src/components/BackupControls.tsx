import { useState } from "react"
import { useOutlineStore } from "../store/useOutlineStore"

const IMPORT_CONFIRMATION_MESSAGE =
  "Import this Actionpad backup? This will replace the current local document."
const JSON_STRING_CHUNK_SIZE = 32_768

function backupFilename(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  return `actionpad-backup-${timestamp}.json`
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

function appendStringSlice(parts: BlobPart[], value: string, start: number, end: number) {
  let chunkStart = start
  while (chunkStart < end) {
    let chunkEnd = Math.min(chunkStart + JSON_STRING_CHUNK_SIZE, end)
    if (
      chunkEnd < end &&
      isHighSurrogate(value.charCodeAt(chunkEnd - 1)) &&
      isLowSurrogate(value.charCodeAt(chunkEnd))
    ) {
      chunkEnd -= 1
    }
    parts.push(value.slice(chunkStart, chunkEnd))
    chunkStart = chunkEnd
  }
}

function unicodeEscape(code: number): string {
  return `\\u${code.toString(16).padStart(4, "0")}`
}

function appendJsonString(parts: BlobPart[], value: string) {
  parts.push('"')
  let chunkStart = 0

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    let replacement: string | null = null

    switch (code) {
      case 0x08:
        replacement = "\\b"
        break
      case 0x09:
        replacement = "\\t"
        break
      case 0x0a:
        replacement = "\\n"
        break
      case 0x0c:
        replacement = "\\f"
        break
      case 0x0d:
        replacement = "\\r"
        break
      case 0x22:
        replacement = '\\"'
        break
      case 0x5c:
        replacement = "\\\\"
        break
      default:
        if (code < 0x20) replacement = unicodeEscape(code)
    }

    if (!replacement) continue

    appendStringSlice(parts, value, chunkStart, index)
    parts.push(replacement)
    chunkStart = index + 1
  }

  appendStringSlice(parts, value, chunkStart, value.length)
  parts.push('"')
}

function isOmittedJsonValue(value: unknown): boolean {
  return value === undefined || typeof value === "function" || typeof value === "symbol"
}

function appendJsonParts(parts: BlobPart[], value: unknown, seen: WeakSet<object>) {
  if (value === null) {
    parts.push("null")
    return
  }

  switch (typeof value) {
    case "string":
      appendJsonString(parts, value)
      return
    case "number":
      parts.push(Number.isFinite(value) ? String(value) : "null")
      return
    case "boolean":
      parts.push(value ? "true" : "false")
      return
    case "bigint":
      throw new TypeError("Could not serialize backup because it contains a BigInt.")
    case "undefined":
    case "function":
    case "symbol":
      throw new Error("Could not serialize backup.")
  }

  if (seen.has(value)) {
    throw new TypeError("Could not serialize backup because it contains a circular reference.")
  }

  const jsonValue = value as { toJSON?: unknown }
  if (typeof jsonValue.toJSON === "function") {
    appendJsonParts(parts, jsonValue.toJSON(), seen)
    return
  }

  seen.add(value)
  if (Array.isArray(value)) {
    parts.push("[")
    value.forEach((item, index) => {
      if (index > 0) parts.push(",")
      if (isOmittedJsonValue(item)) {
        parts.push("null")
      } else {
        appendJsonParts(parts, item, seen)
      }
    })
    parts.push("]")
  } else {
    parts.push("{")
    let needsComma = false
    for (const key of Object.keys(value)) {
      const child = (value as Record<string, unknown>)[key]
      if (isOmittedJsonValue(child)) continue
      if (needsComma) parts.push(",")
      appendJsonString(parts, key)
      parts.push(":")
      appendJsonParts(parts, child, seen)
      needsComma = true
    }
    parts.push("}")
  }
  seen.delete(value)
}

function serializeJsonToBlobParts(value: unknown): BlobPart[] {
  const parts: BlobPart[] = []
  appendJsonParts(parts, value, new WeakSet())
  return parts
}

function downloadJson(filename: string, value: unknown) {
  const parts = serializeJsonToBlobParts(value)
  parts.push("\n")

  const blob = new Blob(parts, {
    type: "application/json",
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text()

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.onerror = () => reject(reader.error ?? new Error("Could not read backup file."))
    reader.readAsText(file)
  })
}

export function BackupControls() {
  const { exportBackup, importBackup } = useOutlineStore()
  const [status, setStatus] = useState<string | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)

  async function handleDownload() {
    if (isDownloading) return
    setIsDownloading(true)
    setStatus("Preparing backup...")

    try {
      const backup = await exportBackup()
      if (!backup) {
        setStatus("No local backup data found.")
        return
      }
      downloadJson(backupFilename(), backup)
      setStatus("Backup downloaded.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not download backup.")
    } finally {
      setIsDownloading(false)
    }
  }

  async function handleImport(file: File | undefined) {
    if (!file) return
    try {
      const parsed = JSON.parse(await readFileAsText(file)) as unknown
      if (!window.confirm(IMPORT_CONFIRMATION_MESSAGE)) return
      await importBackup(parsed)
      setStatus("Backup imported.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not import backup.")
    }
  }

  function handleImportClick() {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "application/json,.json"
    input.onchange = () => void handleImport(input.files?.[0])
    input.click()
  }

  return (
    <div className="backup-controls">
      <button
        className="backup-control-button"
        type="button"
        onClick={handleDownload}
        disabled={isDownloading}
      >
        Download backup
      </button>
      <button
        className="backup-control-button"
        type="button"
        onClick={handleImportClick}
      >
        Import backup
      </button>
      {status ? <span className="backup-status">{status}</span> : null}
    </div>
  )
}
