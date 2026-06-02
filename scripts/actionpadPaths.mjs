import os from "node:os"
import path from "node:path"

export function getActionpadHome(env = process.env) {
  return path.resolve(env.ACTIONPAD_HOME || path.join(os.homedir(), ".actionpad"))
}

export function getActionpadPaths(env = process.env) {
  const home = getActionpadHome(env)
  return {
    home,
    versions: path.join(home, "versions"),
    current: path.join(home, "current"),
    logs: path.join(home, "logs"),
    run: path.join(home, "run"),
    config: path.join(home, "config.env"),
    runtimeLog: path.join(home, "logs", "runtime.log"),
    webLog: path.join(home, "logs", "web.log"),
    runtimePid: path.join(home, "run", "runtime.pid"),
    webPid: path.join(home, "run", "web.pid"),
  }
}

export function displayHomeRelative(filePath, env = process.env) {
  const home = os.homedir()
  return filePath === home || filePath.startsWith(`${home}${path.sep}`)
    ? `~${filePath.slice(home.length)}`
    : filePath
}
