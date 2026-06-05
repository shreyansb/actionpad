// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import { createActionpadRuntimeClient } from "./runtimeClient"

describe("Actionpad runtime MCP client", () => {
  it("requests app refresh and includes runtime URL", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ requested: true }), { status: 202 }))
    const client = createActionpadRuntimeClient({
      runtimeUrl: "http://127.0.0.1:43217/base/",
      fetch: fetchImpl,
    })

    await expect(client.requestAppRefresh()).resolves.toEqual({
      requested: true,
      runtimeUrl: "http://127.0.0.1:43217/base/",
    })
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:43217/app/refresh", {
      method: "POST",
      headers: { accept: "application/json" },
    })
  })

  it("requests runtime restart and returns pending state", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ requested: true, pending: true }), { status: 202 }),
    )
    const client = createActionpadRuntimeClient({
      runtimeUrl: "http://127.0.0.1:43217",
      fetch: fetchImpl,
    })

    await expect(client.requestRuntimeRestart()).resolves.toEqual({
      requested: true,
      pending: true,
      runtimeUrl: "http://127.0.0.1:43217",
    })
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:43217/runtime/restart", {
      method: "POST",
      headers: { accept: "application/json" },
    })
  })

  it("throws concise errors for non-2xx responses", async () => {
    const fetchImpl = vi.fn(async () => new Response("restart disabled by policy", { status: 403 }))
    const client = createActionpadRuntimeClient({
      runtimeUrl: "http://127.0.0.1:43217",
      fetch: fetchImpl,
    })

    await expect(client.requestRuntimeRestart()).rejects.toThrow(
      "Actionpad runtime request failed: POST /runtime/restart returned HTTP 403: restart disabled by policy",
    )
  })

  it("truncates long non-2xx error bodies", async () => {
    const fetchImpl = vi.fn(async () => new Response("x".repeat(220), { status: 500 }))
    const client = createActionpadRuntimeClient({
      runtimeUrl: "http://127.0.0.1:43217",
      fetch: fetchImpl,
    })

    await expect(client.requestAppRefresh()).rejects.toThrow(
      `Actionpad runtime request failed: POST /app/refresh returned HTTP 500: ${"x".repeat(157)}...`,
    )
  })

  it("throws clear errors for fetch failures", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connection refused")
    })
    const client = createActionpadRuntimeClient({
      runtimeUrl: "http://127.0.0.1:43217",
      fetch: fetchImpl,
    })

    await expect(client.requestAppRefresh()).rejects.toThrow(
      "Actionpad runtime request failed: POST /app/refresh to http://127.0.0.1:43217 failed: connection refused",
    )
  })
})
