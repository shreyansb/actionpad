#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(scriptDir, "..")
const defaultR2Bucket = "actionpad"

export function normalizeReleaseVersion(input) {
  const rawVersion = input?.trim()
  if (!rawVersion || rawVersion === "--help" || rawVersion === "-h") {
    throw new Error("Usage: npm run release:new -- <version>")
  }

  const version = rawVersion.startsWith("v") ? rawVersion.slice(1) : rawVersion
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid version "${input}". Use semver like 0.1.2 or v0.1.2.`)
  }
  return version
}

export function updateReleaseMetadata(packageJson, packageLock, version) {
  const nextPackageJson = { ...packageJson, version }
  const nextPackageLock = { ...packageLock, version }
  nextPackageLock.packages = { ...(packageLock.packages ?? {}) }
  nextPackageLock.packages[""] = { ...(nextPackageLock.packages[""] ?? {}), version }
  return { packageJson: nextPackageJson, packageLock: nextPackageLock }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"))
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], { cwd: root, stdio: "ignore", shell: false })
  return result.status === 0
}

export function getR2UploadPlan(version, bucket = defaultR2Bucket) {
  return [
    { file: "scripts/install.sh", key: "install.sh" },
    { file: "release/actionpad.tar.gz", key: "actionpad.tar.gz" },
    { file: `release/actionpad-${version}.tar.gz`, key: `actionpad-${version}.tar.gz` },
    { file: `release/actionpad-${version}.tar.gz`, key: `actionpad-v${version}.tar.gz` },
  ].map((item) => ({
    ...item,
    bucket,
    object: `${bucket}/${item.key}`,
  }))
}

export function getWranglerUploadArgs(upload) {
  return ["r2", "object", "put", upload.object, "--file", upload.file, "--remote"]
}

export function shouldSkipR2Upload(env = process.env) {
  return env.ACTIONPAD_R2_UPLOAD === "0" || env.ACTIONPAD_R2_UPLOAD === "false"
}

export function uploadReleaseToR2(version, env = process.env) {
  if (shouldSkipR2Upload(env)) {
    console.log("Skipped Cloudflare R2 upload because ACTIONPAD_R2_UPLOAD=0")
    return
  }

  if (!commandExists("wrangler")) {
    console.error("Cloudflare Wrangler is required to upload this release to R2.")
    console.error("Install it with: npm install -g wrangler")
    console.error("Then authenticate with: wrangler login")
    process.exit(1)
  }

  const bucket = env.ACTIONPAD_R2_BUCKET || defaultR2Bucket
  for (const upload of getR2UploadPlan(version, bucket)) {
    console.log(`Uploading ${upload.file} to r2://${upload.object}`)
    run("wrangler", getWranglerUploadArgs(upload))
  }
}

export async function prepareRelease(versionInput) {
  const version = normalizeReleaseVersion(versionInput)
  const packageJsonPath = path.join(root, "package.json")
  const packageLockPath = path.join(root, "package-lock.json")
  const { packageJson, packageLock } = updateReleaseMetadata(
    await readJson(packageJsonPath),
    await readJson(packageLockPath),
    version,
  )

  await writeJson(packageJsonPath, packageJson)
  await writeJson(packageLockPath, packageLock)
  console.log(`Updated release metadata to ${version}`)
  return version
}

async function main() {
  const version = await prepareRelease(process.argv[2])
  run("npm", ["run", "release:pack"])
  uploadReleaseToR2(version)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
