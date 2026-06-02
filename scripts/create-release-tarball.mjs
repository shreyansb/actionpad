#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(scriptDir, "..")
const releaseDir = path.join(root, "release")
const stageDir = path.join(releaseDir, "actionpad")
const tarball = path.join(releaseDir, "actionpad.tar.gz")

async function getPackageVersion() {
  const packageJson = JSON.parse(await fs.promises.readFile(path.join(root, "package.json"), "utf8"))
  return packageJson.version
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

async function copyIfExists(relativePath) {
  const source = path.join(root, relativePath)
  try {
    await fs.promises.access(source)
  } catch {
    return
  }
  const target = path.join(stageDir, relativePath)
  await fs.promises.mkdir(path.dirname(target), { recursive: true })
  await fs.promises.cp(source, target, {
    recursive: true,
    filter: (item) => {
      const base = path.basename(item)
      return (
        base !== "node_modules" &&
        base !== ".git" &&
        base !== ".env" &&
        !base.endsWith("~") &&
        !base.endsWith(".bak")
      )
    },
  })
}

async function main() {
  const version = await getPackageVersion()
  run("npm", ["ci"])
  run("npm", ["test", "--", "src"])
  run("npm", ["run", "lint"])
  run("npm", ["run", "build"])

  await fs.promises.rm(releaseDir, { recursive: true, force: true })
  await fs.promises.mkdir(stageDir, { recursive: true })

  for (const item of [
    "package.json",
    "package-lock.json",
    "index.html",
    "outline.txt",
    "dist",
    "runtime",
    "scripts",
    "src",
    "tsconfig.json",
    "vite.config.ts",
    "docs/actionpad-install.md",
  ]) {
    await copyIfExists(item)
  }

  run("tar", ["-czf", tarball, "-C", stageDir, "."])
  await fs.promises.copyFile(tarball, path.join(releaseDir, `actionpad-${version}.tar.gz`))
  await fs.promises.rm(stageDir, { recursive: true, force: true })
  console.log(`Created ${tarball}`)
  console.log(`Created ${path.join(releaseDir, `actionpad-${version}.tar.gz`)}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
