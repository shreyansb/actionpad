#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import process from "node:process"

mkdirSync("dist-runtime", { recursive: true })

const result = spawnSync(
  "bun",
  ["build", "runtime/entry.ts", "--compile", "--outfile", "dist-runtime/actionpad-runtime"],
  { stdio: "inherit" },
)

process.exit(result.status ?? 1)
