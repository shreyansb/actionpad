// @vitest-environment node
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const installScript = path.join(scriptDir, "install.sh")

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

async function writeExecutable(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, contents, { mode: 0o755 })
  await fs.chmod(filePath, 0o755)
}

async function createReleaseTarball(workDir, version) {
  const packageDir = path.join(workDir, `actionpad-${version}`)
  await fs.mkdir(path.join(packageDir, "scripts"), { recursive: true })
  await fs.writeFile(
    path.join(packageDir, "package.json"),
    JSON.stringify({ name: "actionpad-test-release", version }, null, 2),
  )
  await writeExecutable(
    path.join(packageDir, "scripts", "actionpad.mjs"),
    "#!/usr/bin/env node\nif (process.argv[2] === 'doctor') process.exit(0)\n",
  )
  await writeExecutable(path.join(packageDir, "scripts", "serve-dist.mjs"), "#!/usr/bin/env node\n")

  const tarball = path.join(workDir, `actionpad-${version}.tar.gz`)
  await execFileAsync("tar", ["-czf", tarball, "-C", packageDir, "."])
  return tarball
}

async function runInstaller(tarball, env) {
  return execFileAsync("bash", [installScript], {
    env: {
      ...process.env,
      ...env,
      ACTIONPAD_TARBALL_URL: `file://${tarball}`,
    },
  })
}

describe("install.sh", () => {
  it("updates current to the newest successful install", async () => {
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "actionpad-install-test-"))
    const home = path.join(workDir, "home")
    const installBin = path.join(workDir, "bin")
    const fakeBin = path.join(workDir, "fake-bin")
    await writeExecutable(path.join(fakeBin, "npm"), "#!/usr/bin/env bash\nprintf 'npm noisy output\\n'\nexit 0\n")

    const env = {
      ACTIONPAD_HOME: home,
      ACTIONPAD_INSTALL_BIN: installBin,
      PATH: `${fakeBin}:${installBin}:${process.env.PATH}`,
    }

    const result = await runInstaller(await createReleaseTarball(workDir, "0.1.1"), env)
    await runInstaller(await createReleaseTarball(workDir, "0.1.2"), env)

    await expect(fs.readlink(path.join(home, "current"))).resolves.toBe(path.join(home, "versions", "0.1.2"))
    expect(result.stderr).toBe("")
    expect(result.stdout).toContain("Installing Actionpad...")
    expect(result.stdout).toContain("  Installing dependencies")
    expect(result.stdout).toContain("Installed Actionpad 0.1.1.")
    expect(result.stdout).not.toContain("npm noisy output")
    expect(result.stdout).not.toContain("npm ci --prefix")

    const logFiles = await fs.readdir(path.join(home, "logs"))
    const installLog = logFiles.find((file) => file.startsWith("install-"))
    expect(installLog).toBeTruthy()
    await expect(fs.readFile(path.join(home, "logs", installLog), "utf8")).resolves.toContain("npm noisy output")
  })
})
