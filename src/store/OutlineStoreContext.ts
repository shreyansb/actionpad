import { createContext, type Dispatch } from "react"
import type { BulletId, OutlineState } from "../domain/types"
import type { FilesystemListResponse } from "../domain/runtimeProtocol"
import type { ActionpadBackup } from "../persistence/documentPersistence"
import type { OutlineAction } from "./outlineReducer"

export type OutlineStoreValue = {
  state: OutlineState
  dispatch: Dispatch<OutlineAction>
  executeNode: (nodeId: BulletId) => void
  sendChatMessage: (threadId: string, message: string) => void
  cancelRun: (runId: string) => void
  exportBackup: () => Promise<ActionpadBackup | null>
  importBackup: (backup: unknown) => Promise<void>
  listFilesystem: (path?: string | null, query?: string) => Promise<FilesystemListResponse>
}

export const OutlineStoreContext = createContext<OutlineStoreValue | null>(null)
