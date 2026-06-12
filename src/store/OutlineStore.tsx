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
  AgentRuntimeEvent,
  BulletMention,
  OutlinePatch,
  SendMessageRequest,
  StartRunRequest,
} from "../domain/runtimeProtocol"
import {
  createIndexedDbDocumentPersistence,
  type DocumentPersistence,
} from "../persistence/documentPersistence"
import { isActionpadPerfEnabled, measurePerf, measurePerfAsync } from "../perf"
import { ActionpadRuntimeClient, getRuntimeUrl } from "../runtimeClient/runtimeClient"
import { outlineReducer, type OutlineAction } from "./outlineReducer"
import { OutlineActionsContext } from "./OutlineActionsContext"
import { OutlineStateContext } from "./OutlineStateContext"
import { OutlineStoreContext } from "./OutlineStoreContext"

let idSequence = 0
const AUTOSAVE_DEBOUNCE_MS = 1_500
const AUTOSAVE_IDLE_TIMEOUT_MS = 5_000
const RUN_RECONCILE_DISCONNECT_MS = 3_000

type IdleSchedulingWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

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

function hasActiveRuns(state: OutlineState): boolean {
  return Object.values(state.nodes).some((node) => node.runStatus === "running")
}

function hasActiveRunsAfterReconcile(
  state: OutlineState,
  activeRunIds: string[],
  activeNodeIds: string[],
): boolean {
  return Object.values(state.nodes).some(
    (node) =>
      node.runStatus === "running" &&
      ((node.activeRunId !== undefined && activeRunIds.includes(node.activeRunId)) ||
        (node.activeRunId === undefined && activeNodeIds.includes(node.id))),
  )
}

function hasActiveRunsAfterTerminalEvent(state: OutlineState, event: AgentRuntimeEvent): boolean {
  if (
    event.type !== "run-completed" &&
    event.type !== "run-failed" &&
    (event.type !== "outline-patch" || event.patch.outcome === undefined)
  ) {
    return hasActiveRuns(state)
  }
  return Object.values(state.nodes).some(
    (node) => node.runStatus === "running" && node.activeRunId !== event.runId,
  )
}

function measuredOutlineReducer(state: OutlineState, action: OutlineAction): OutlineState {
  if (!isActionpadPerfEnabled()) return outlineReducer(state, action)

  return measurePerf(
    `reducer.${action.type}`,
    {
      nodeCount: Object.keys(state.nodes).length,
      rootCount: state.rootIds.length,
      undoDepth: state.undoStack.length,
      redoDepth: state.redoStack.length,
    },
    () => outlineReducer(state, action),
  )
}

function scheduleIdleWork(callback: () => void): () => void {
  const idleWindow = window as IdleSchedulingWindow
  if (typeof idleWindow.requestIdleCallback === "function") {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: AUTOSAVE_IDLE_TIMEOUT_MS })
    return () => idleWindow.cancelIdleCallback?.(handle)
  }

  const timeout = window.setTimeout(callback, 0)
  return () => window.clearTimeout(timeout)
}

export function OutlineStoreProvider({
  children,
  initialState,
  persistence,
  reloadApp = () => window.location.reload(),
}: {
  children: ReactNode
  initialState?: OutlineState
  persistence?: DocumentPersistence | null
  reloadApp?: () => void
}) {
  const initialStateRef = useRef(initialState)
  const persistenceRef = useRef<DocumentPersistence | null>(
    persistence === undefined ? createIndexedDbDocumentPersistence() : persistence,
  )
  const [state, dispatch] = useReducer(
    measuredOutlineReducer,
    initialStateRef.current ?? createDefaultOutlineState(),
  )
  const stateRef = useRef(state)
  const [hydrated, setHydrated] = useState(false)
  const runtimeClientRef = useRef<ActionpadRuntimeClient | null>(null)
  const reloadAppRef = useRef(reloadApp)
  const appRefreshPendingRef = useRef(false)
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
    stateRef.current = state
  }, [state])

  useEffect(() => {
    panelOpenRef.current = state.panelOpen
  }, [state.panelOpen])

  useEffect(() => {
    reloadAppRef.current = reloadApp
  }, [reloadApp])

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

    let cancelIdleSave: (() => void) | null = null
    const timeout = window.setTimeout(() => {
      const stateToSave = state
      cancelIdleSave = scheduleIdleWork(() => {
        measurePerfAsync(
          "persistence.saveDocument",
          {
            nodeCount: Object.keys(stateToSave.nodes).length,
            undoDepth: stateToSave.undoStack.length,
            redoDepth: stateToSave.redoStack.length,
          },
          () => persistenceRef.current!.saveDocument(stateToSave),
        ).catch((error) => {
          console.warn("Actionpad could not save persisted document.", error)
        })
      })
    }, AUTOSAVE_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timeout)
      cancelIdleSave?.()
    }
  }, [hydrated, state])

  const reconcileActiveRuns = useCallback(async () => {
    if (!hasActiveRuns(stateRef.current)) return

    let activeRunIds: string[] = []
    let activeNodeIds: string[] = []
    try {
      const response = await runtimeClientRef.current!.listActiveRuns()
      activeRunIds = response.runs
        .map((run) => run.runId)
        .filter((runId): runId is string => runId !== null)
      activeNodeIds = response.runs.map((run) => run.nodeId)
    } catch {
      // Runs do not survive a runtime exit, so an unreachable runtime means
      // every locally tracked run is stale and gets cleared below.
    }

    dispatch({ type: "reconcile-runs", activeRunIds, activeNodeIds, createdAt: Date.now() })
    if (
      appRefreshPendingRef.current &&
      !hasActiveRunsAfterReconcile(stateRef.current, activeRunIds, activeNodeIds)
    ) {
      appRefreshPendingRef.current = false
      reloadAppRef.current()
    }
  }, [])

  useEffect(() => {
    if (!hydrated) return
    void reconcileActiveRuns()
  }, [hydrated, reconcileActiveRuns])

  useEffect(() => {
    let disconnectReconcileTimer: number | null = null

    const unsubscribe = runtimeClientRef.current?.subscribe(
      (event) => {
        if (event.type === "app-refresh-requested") {
          if (hasActiveRuns(stateRef.current)) {
            appRefreshPendingRef.current = true
            return
          }
          reloadAppRef.current()
          return
        }

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
        if (
          appRefreshPendingRef.current &&
          (event.type === "run-completed" ||
            event.type === "run-failed" ||
            (event.type === "outline-patch" && event.patch.outcome !== undefined)) &&
          !hasActiveRunsAfterTerminalEvent(stateRef.current, event)
        ) {
          appRefreshPendingRef.current = false
          reloadAppRef.current()
        }
      },
      (connected) => {
        if (connected) {
          if (disconnectReconcileTimer !== null) {
            window.clearTimeout(disconnectReconcileTimer)
            disconnectReconcileTimer = null
          }
          void reconcileActiveRuns()
          return
        }
        if (disconnectReconcileTimer !== null) return
        disconnectReconcileTimer = window.setTimeout(() => {
          disconnectReconcileTimer = null
          void reconcileActiveRuns()
        }, RUN_RECONCILE_DISCONNECT_MS)
      },
    )

    return () => {
      if (disconnectReconcileTimer !== null) {
        window.clearTimeout(disconnectReconcileTimer)
      }
      unsubscribe?.()
    }
  }, [reconcileActiveRuns])

  const executeNode = useCallback(
    (nodeId: BulletId) => {
      const state = stateRef.current
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
    [],
  )

  const sendChatMessage = useCallback(
    (threadId: string, message: string) => {
      const state = stateRef.current
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
    [],
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
    return measurePerfAsync(
      "runtime.listFilesystem",
      { path: path ?? null, query: query ?? "" },
      () => runtimeClientRef.current!.listFilesystem(path, query),
    )
  }, [])

  const openDocument = useCallback((path: string) => {
    setPanelDocument({ path, content: null, loading: true, error: null })
    dispatch({ type: "select-thread", threadId: null })
    dispatch({ type: "open-panel" })
  }, [])

  const loadPanelDocument = useCallback((path: string) => {
    return measurePerfAsync("runtime.readFile", { path }, () => runtimeClientRef.current!.readFile(path))
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

  const actions = useMemo(
    () => ({
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

  return (
    <OutlineActionsContext.Provider value={actions}>
      <OutlineStateContext.Provider value={state}>
        <OutlineStoreContext.Provider value={value}>{children}</OutlineStoreContext.Provider>
      </OutlineStateContext.Provider>
    </OutlineActionsContext.Provider>
  )
}
