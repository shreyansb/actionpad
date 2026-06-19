export const RUNTIME_RESTART_EXIT_CODE = 75

export function shouldRestartRuntimeProcess({ name, code, signal, shuttingDown }) {
  return (
    !shuttingDown &&
    name === "runtime" &&
    code === RUNTIME_RESTART_EXIT_CODE &&
    signal === null
  )
}
