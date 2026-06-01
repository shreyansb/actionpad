import { createContext, type Dispatch } from "react"
import type { BulletId, OutlineState } from "../domain/types"
import type { FilesystemReadResponse, FilesystemListResponse } from "../domain/runtimeProtocol"
import type { ActionpadBackup } from "../persistence/documentPersistence"
import type { OutlineAction } from "./outlineReducer"

export type PanelDocumentState = {
  path: string
  content: string | null
  loading: boolean
  error: string | null
}

export type OutlineStoreValue = {
  state: OutlineState
  panelDocument: PanelDocumentState | null
  dispatch: Dispatch<OutlineAction>
  executeNode: (nodeId: BulletId) => void
  sendChatMessage: (threadId: string, message: string) => void
  cancelRun: (runId: string) => void
  exportBackup: () => Promise<ActionpadBackup | null>
  importBackup: (backup: unknown) => Promise<void>
  listFilesystem: (path?: string | null, query?: string) => Promise<FilesystemListResponse>
  openDocument: (path: string) => void
  loadPanelDocument: (path: string) => Promise<FilesystemReadResponse>
  setPanelDocumentLoaded: (path: string, content: string) => void
  setPanelDocumentError: (path: string, error: string) => void
  clearPanelDocument: () => void
}

export const OutlineStoreContext = createContext<OutlineStoreValue | null>(null)
