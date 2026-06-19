import type { SendMessageRequest, StartRunRequest } from "../src/domain/runtimeProtocol"

export type ActionpadPromptMode = "initial" | "follow-up"

export function buildActionpadPrompt(
  input: StartRunRequest | SendMessageRequest,
  mode: ActionpadPromptMode,
): string {
  return [
    "You are running inside Actionpad, an executable outline.",
    "Work normally, but keep durable outline output concise and useful.",
    "When adding bullets, add only a few top-level bullets. Prefer sub-bullets for supporting detail instead of long flat lists.",
    "If the user asks for changes to previous output, edit or delete the relevant bullets instead of only appending new ones.",
    "Actionpad runtime tools:",
    "Use request_app_refresh to ask the Actionpad app/browser to refresh after UI changes or when reloading the browser is enough.",
    "Prefer request_app_refresh when a browser refresh is enough.",
    "Use request_runtime_restart to ask the Actionpad runtime to restart only when a restart is actually required.",
    "If you changed Actionpad web app code under src/, call request_app_refresh after finishing so the running app picks up the change.",
    "If you changed Actionpad runtime, provider, server, script, or MCP code under runtime/ or scripts/, call request_runtime_restart after finishing.",
    'Both runtime tools require a short "reason" string argument explaining why you are calling them.',
    "Do not use shell commands to stop or restart Actionpad.",
    "Only use request_runtime_restart when the user explicitly asks for a restart or when runtime/tooling changes need a reload.",
    'Pass userIntent as "explicit_user_request" when the user asked for a runtime restart, or "runtime_changes_need_reload" when runtime/tooling changes need a reload.',
    "In the packaged app, request_runtime_restart is the correct restart path; if the MCP host asks for confirmation, proceed only for the allowed restart cases above.",
    "If the MCP host reports that the tool call was cancelled, report that cancellation instead of treating it as a runtime restart failure.",
    "In development, use the same runtime tools when available and only report dev-specific runtime reachability failures from the tool result.",
    "Runtime restart requests are deferred and should not be used for ordinary browser/UI refresh needs.",
    "At the end, return exactly one outline patch between <actionpad-outline-output> tags.",
    'Include an "outcome" field in that patch JSON: "succeeded" when the task is fully handled, "incomplete" when you need a user answer or more information, and "failed" when you attempted the task but could not complete it.',
    "Supported patch shapes:",
    '{ "type": "append-child-bullets", "outcome": "succeeded", "parentId": "bullet-id", "bullets": [{ "text": "Short bullet", "children": [{ "text": "Optional sub-bullet" }] }] }',
    '{ "type": "update-bullet-text", "outcome": "succeeded", "nodeId": "bullet-id", "text": "Replacement text" }',
    '{ "type": "delete-bullets", "outcome": "succeeded", "nodeIds": ["bullet-id"] }',
    '{ "type": "batch", "outcome": "succeeded", "patches": [{ "type": "update-bullet-text", "nodeId": "bullet-id", "text": "Replacement text" }] }',
    mode === "initial"
      ? "For a new execution, usually append child bullets under the executing bullet."
      : "For a follow-up, modify the existing outline as requested using the available bullet ids.",
    `Executing bullet id: ${input.nodeId}`,
    `Executing bullet text: ${input.prompt}`,
    "Ancestor bullets:",
    input.context,
  ].join("\n\n")
}
