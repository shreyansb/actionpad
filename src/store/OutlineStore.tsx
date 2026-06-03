import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react"
import type { ReactNode } from "react"
import { buildRunContext } from "../domain/context"
import { createDefaultOutlineState } from "../domain/fixtures"
import type { BulletId, OutlineState } from "../domain/types"
import type {
  BulletMention,
  OutlinePatch,
  SendMessageRequest,
  StartRunRequest,
} from "../domain/runtimeProtocol"
import {
  createIndexedDbDocumentPersistence,
  type DocumentPersistence,
} from "../persistence/documentPersistence"
import { ActionpadRuntimeClient, getRuntimeUrl } from "../runtimeClient/runtimeClient"
import { outlineReducer, type OutlineAction } from "./outlineReducer"
import { OutlineStoreContext } from "./OutlineStoreContext"

let idSequence = 0

function nextId(prefix: string): string {
  idSequence += 1
  return `${prefix}-${Date.now()}-${idSequence}-${Math.random().toString(36).slice(2, 8)}`
}

function countDrafts(drafts: Array<{ children?: unknown[] }>): number {
  return drafts.reduce(
    (count, draft) =>
      count +
      1 +
      (Array.isArray(draft.children)
        ? countDrafts(draft.children as Array<{ children?: unknown[] }>)
        : 0),
    0,
  )
}

function countPatchDrafts(patch: OutlinePatch): number {
  switch (patch.type) {
    case "append-child-bullets":
      return countDrafts(patch.bullets)
    case "batch":
      return patch.patches.reduce((count, childPatch) => count + countPatchDrafts(childPatch), 0)
    default:
      return 0
  }
}

function getActiveMentions(nodeText: string, mentions: BulletMention[] | undefined): BulletMention[] {
  return (mentions ?? []).filter((mention) => nodeText.includes(mention.token))
}

export function OutlineStoreProvider({
  children,
  initialState,
  persistence,
}: {
  children: ReactNode
  initialState?: OutlineState
  persistence?: DocumentPersistence | null
}) {
  const initialStateRef = useRef(initialState)
  const persistenceRef = useRef<DocumentPersistence | null>(
    persistence === undefined ? createIndexedDbDocumentPersistence() : persistence,
  )
  const [state, dispatch] = useReducer(
    outlineReducer,
    initialStateRef.current ?? createDefaultOutlineState(),
  )
  const [hydrated, setHydrated] = useState(false)
  const runtimeClientRef = useRef<ActionpadRuntimeClient | null>(null)
  const panelOpenRef = useRef(state.panelOpen)
  const [panelDocument, setPanelDocument] = useState<{
    path: string
    content: string | null
    loading: boolean
    error: string | null
  } | null>(null)

  if (!runtimeClientRef.current) {
    runtimeClientRef.current = new ActionpadRuntimeClient(getRuntimeUrl())
  }

  useEffect(() => {
    panelOpenRef.current = state.panelOpen
  }, [state.panelOpen])

  useEffect(() => {
    let cancelled = false

    async function loadPersistedDocument() {
      if (!persistenceRef.current || initialStateRef.current) {
        setHydrated(true)
        return
      }

      try {
        const persistedState = await persistenceRef.current.loadDocument()
        if (!cancelled && persistedState) {
          dispatch({ type: "hydrate-state", state: persistedState })
        }
      } catch (error) {
        console.warn("Actionpad could not load persisted document.", error)
      } finally {
        if (!cancelled) setHydrated(true)
      }
    }

    void loadPersistedDocument()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!persistenceRef.current || !hydrated || initialStateRef.current) return

    const timeout = window.setTimeout(() => {
      persistenceRef.current?.saveDocument(state).catch((error) => {
        console.warn("Actionpad could not save persisted document.", error)
      })
    }, 500)

    return () => window.clearTimeout(timeout)
  }, [hydrated, state])

  useEffect(
    () =>
      runtimeClientRef.current?.subscribe((event) => {
        const generatedIds =
          event.type === "outline-patch"
            ? Array.from({ length: countPatchDrafts(event.patch) }, () => nextId("generated"))
            : undefined
        dispatch({
          type: "runtime-event",
          event,
          createdAt: event.createdAt,
          generatedIds,
        })
        if (event.type === "run-started" && panelOpenRef.current) {
          dispatch({ type: "request-chat-focus" })
        }
      }),
    [],
  )

  const executeNode = useCallback(
    (nodeId: BulletId) => {
      const node = state.nodes[nodeId]
      if (!node) return
      if (node.runStatus === "running" && !node.threadId) return

      if (node.threadId) {
        setPanelDocument(null)
        dispatch({ type: "select-thread", threadId: node.threadId, seenAt: Date.now() })
        dispatch({ type: "open-panel" })
        dispatch({ type: "request-chat-focus" })
        return
      }

      const threadId = nextId("thread")
      const context = buildRunContext(nodeId, state)
      const mentions = getActiveMentions(node.text, node.metadata.mentions)
      const request: StartRunRequest = {
        provider: "codex",
        nodeId,
        prompt: node.text,
        context,
        ...(mentions.length > 0 ? { mentions } : {}),
      }

      dispatch({ type: "run-started-optimistic", nodeId, createdAt: Date.now() })
      runtimeClientRef.current
        ?.startRun(request)
        .catch((error) => {
          const message =
            error instanceof Error
              ? error.message
              : "Actionpad runtime is not running. Start the runtime and try again."
          console.error(message)
          dispatch({
            type: "run-failed-local",
            nodeId,
            threadId,
            runId: nextId("failed-run"),
            context,
            error: "Actionpad runtime is not running. Start the runtime and try again.",
            createdAt: Date.now(),
          })
        })
    },
    [state],
  )

  const sendChatMessage = useCallback(
    (threadId: string, message: string) => {
      const thread = state.threads[threadId]
      const node = thread ? state.nodes[thread.nodeId] : null
      if (!thread || !node || node.runStatus === "running" || !message.trim()) return

      const mentions = getActiveMentions(node.text, node.metadata.mentions)
      const request: SendMessageRequest = {
        provider: thread.provider,
        threadId,
        providerThreadId: thread.providerThreadId,
        nodeId: node.id,
        prompt: message,
        context: buildRunContext(node.id, state),
        ...(mentions.length > 0 ? { mentions } : {}),
      }

      runtimeClientRef.current?.sendMessage(request).catch((error) => {
        const runId = nextId("failed-run")
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Actionpad runtime is not running. Start the runtime and try again."
        console.error(errorMessage)
        dispatch({
          type: "run-failed-local",
          nodeId: node.id,
          threadId,
          runId,
          context: message,
          error: "Actionpad runtime is not running. Start the runtime and try again.",
          createdAt: Date.now(),
        })
      })
    },
    [state],
  )

  const cancelRun = useCallback((runId: string) => {
    runtimeClientRef.current?.cancelRun(runId).catch((error) => {
      const message = error instanceof Error ? error.message : "Actionpad runtime could not stop the run."
      console.error(message)
    })
  }, [])

  const exportBackup = useCallback(() => {
    return persistenceRef.current?.exportBackup?.() ?? Promise.resolve(null)
  }, [])

  const importBackup = useCallback(async (backup: unknown) => {
    if (!persistenceRef.current?.importBackup) {
      throw new Error("IndexedDB backups are unavailable.")
    }
    const importedState = await persistenceRef.current.importBackup(backup)
    dispatch({ type: "hydrate-state", state: importedState })
  }, [])

  const listFilesystem = useCallback((path?: string | null, query?: string) => {
    return runtimeClientRef.current!.listFilesystem(path, query)
  }, [])

  const openDocument = useCallback((path: string) => {
    setPanelDocument({ path, content: null, loading: true, error: null })
    dispatch({ type: "select-thread", threadId: null })
    dispatch({ type: "open-panel" })
  }, [])

  const loadPanelDocument = useCallback((path: string) => {
    return runtimeClientRef.current!.readFile(path)
  }, [])

  const setPanelDocumentLoaded = useCallback((path: string, content: string) => {
    setPanelDocument((current) =>
      current?.path === path ? { ...current, content, loading: false, error: null } : current,
    )
  }, [])

  const setPanelDocumentError = useCallback((path: string, error: string) => {
    setPanelDocument((current) =>
      current?.path === path ? { ...current, content: null, loading: false, error } : current,
    )
  }, [])

  const clearPanelDocument = useCallback(() => {
    setPanelDocument(null)
  }, [])

  const value = useMemo(
    () => ({
      state,
      panelDocument,
      dispatch,
      executeNode,
      sendChatMessage,
      cancelRun,
      exportBackup,
      importBackup,
      listFilesystem,
      openDocument,
      loadPanelDocument,
      setPanelDocumentLoaded,
      setPanelDocumentError,
      clearPanelDocument,
    }),
    [
      state,
      panelDocument,
      executeNode,
      sendChatMessage,
      cancelRun,
      exportBackup,
      importBackup,
      listFilesystem,
      openDocument,
      loadPanelDocument,
      setPanelDocumentLoaded,
      setPanelDocumentError,
      clearPanelDocument,
    ],
  )

  return <OutlineStoreContext.Provider value={value}>{children}</OutlineStoreContext.Provider>
}
