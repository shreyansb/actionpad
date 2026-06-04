import { createContext, useContext, type Dispatch } from "react"
import type { BulletId } from "../domain/types"
import type { FilesystemListResponse, FilesystemReadResponse } from "../domain/runtimeProtocol"
import type { ActionpadBackup } from "../persistence/documentPersistence"
import type { OutlineAction } from "./outlineReducer"

export type OutlineActions = {
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

export const OutlineActionsContext = createContext<OutlineActions | null>(null)

export function useOutlineActions(): OutlineActions {
  const value = useContext(OutlineActionsContext)
  if (!value) throw new Error("useOutlineActions must be used inside OutlineStoreProvider")
  return value
}
