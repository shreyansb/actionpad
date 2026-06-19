export const runtimeRestartExitCode = 75

type RuntimeRestartHandle = {
  close(): Promise<void>
}

type RuntimeRestartOptions = {
  handle: RuntimeRestartHandle
  exit?: (code: number) => void
  log?: (message: string) => void
}

export async function requestRuntimeProcessRestart({
  handle,
  exit = process.exit,
  log = console.log,
}: RuntimeRestartOptions): Promise<void> {
  log("Actionpad runtime restart requested; exiting for supervisor restart.")
  await handle.close()
  exit(runtimeRestartExitCode)
}
