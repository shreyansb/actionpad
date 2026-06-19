type PerfDetail = Record<string, unknown>

type PerfEntry = {
  name: string
  durationMs: number
  at: number
  detail?: PerfDetail
}

type PerfSummaryRow = {
  name: string
  count: number
  avgMs: number
  p50Ms: number
  p95Ms: number
  maxMs: number
}

type ActionpadPerfConsole = {
  entries: PerfEntry[]
  clear: () => void
  report: (limit?: number) => void
  summary: () => PerfSummaryRow[]
  slow: (thresholdMs?: number) => PerfEntry[]
}

declare global {
  interface Window {
    actionpadPerf?: ActionpadPerfConsole
  }
}

const MAX_ENTRIES = 5000
const DEFAULT_SLOW_THRESHOLD_MS = 16

let announced = false
let enabledCache: boolean | null = null

function getNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now()
}

function isEnabledFromUrl(): boolean {
  if (typeof window === "undefined") return false
  try {
    return new URLSearchParams(window.location.search).has("perf")
  } catch {
    return false
  }
}

function isEnabledFromStorage(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem("actionpad:perf") === "1"
  } catch {
    return false
  }
}

export function isActionpadPerfEnabled(): boolean {
  if (enabledCache === null) {
    enabledCache =
      (import.meta.env.DEV && import.meta.env.MODE !== "test") ||
      isEnabledFromUrl() ||
      isEnabledFromStorage()
  }
  return enabledCache
}

export function getActionpadPerfSnapshot(): unknown | null {
  const perfConsole = getPerfConsole()
  if (!perfConsole || typeof window === "undefined") return null

  return {
    exportedAt: new Date().toISOString(),
    location: window.location.href,
    userAgent: window.navigator.userAgent,
    entryCount: perfConsole.entries.length,
    summary: perfConsole.summary(),
    entries: perfConsole.entries,
  }
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0
  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * values.length) - 1),
  )
  return values[index]
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10
}

function getPerfConsole(): ActionpadPerfConsole | null {
  if (!isActionpadPerfEnabled() || typeof window === "undefined") return null
  if (window.actionpadPerf) return window.actionpadPerf

  const entries: PerfEntry[] = []
  window.actionpadPerf = {
    entries,
    clear() {
      entries.length = 0
      console.info("[actionpad perf] cleared")
    },
    report(limit = 40) {
      console.table(window.actionpadPerf?.summary().slice(0, limit) ?? [])
      console.table(window.actionpadPerf?.slow().slice(-limit) ?? [])
    },
    summary() {
      const byName = new Map<string, number[]>()
      for (const entry of entries) {
        const durations = byName.get(entry.name) ?? []
        durations.push(entry.durationMs)
        byName.set(entry.name, durations)
      }

      return Array.from(byName.entries())
        .map(([name, durations]) => {
          const sorted = [...durations].sort((left, right) => left - right)
          const total = sorted.reduce((sum, duration) => sum + duration, 0)
          return {
            name,
            count: sorted.length,
            avgMs: roundMs(total / sorted.length),
            p50Ms: roundMs(percentile(sorted, 50)),
            p95Ms: roundMs(percentile(sorted, 95)),
            maxMs: roundMs(sorted[sorted.length - 1] ?? 0),
          }
        })
        .sort((left, right) => right.p95Ms - left.p95Ms)
    },
    slow(thresholdMs = DEFAULT_SLOW_THRESHOLD_MS) {
      return entries.filter((entry) => entry.durationMs >= thresholdMs)
    },
  }

  if (!announced) {
    announced = true
    console.info(
      "[actionpad perf] enabled. Use actionpadPerf.report(), actionpadPerf.summary(), actionpadPerf.slow(), or actionpadPerf.clear().",
    )
  }

  return window.actionpadPerf
}

export function recordPerf(name: string, durationMs: number, detail?: PerfDetail): void {
  const perfConsole = getPerfConsole()
  if (!perfConsole) return

  const entry: PerfEntry = {
    name,
    durationMs: roundMs(durationMs),
    at: Date.now(),
    ...(detail ? { detail } : {}),
  }
  perfConsole.entries.push(entry)
  if (perfConsole.entries.length > MAX_ENTRIES) {
    perfConsole.entries.splice(0, perfConsole.entries.length - MAX_ENTRIES)
  }

  if (entry.durationMs >= DEFAULT_SLOW_THRESHOLD_MS) {
    console.debug(`[actionpad perf] ${entry.name}: ${entry.durationMs}ms`, detail ?? "")
  }
}

export function measurePerf<T>(name: string, detail: PerfDetail | undefined, fn: () => T): T {
  if (!isActionpadPerfEnabled()) return fn()
  const start = getNow()
  try {
    return fn()
  } finally {
    recordPerf(name, getNow() - start, detail)
  }
}

export async function measurePerfAsync<T>(
  name: string,
  detail: PerfDetail | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!isActionpadPerfEnabled()) return fn()
  const start = getNow()
  try {
    return await fn()
  } finally {
    recordPerf(name, getNow() - start, detail)
  }
}

export function measureInteractionToPaint(name: string, detail?: PerfDetail): void {
  if (!isActionpadPerfEnabled() || typeof window === "undefined") return
  const start = getNow()
  const record = () => recordPerf(`interaction.${name}`, getNow() - start, detail)

  if (typeof window.requestAnimationFrame !== "function") {
    window.setTimeout(record, 0)
    return
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(record)
  })
}
