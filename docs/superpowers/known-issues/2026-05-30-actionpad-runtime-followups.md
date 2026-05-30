# Actionpad Runtime Follow-Ups

These are non-blocking issues captured during the runtime prototype work. Per prototype scope, only P0/P1 issues should interrupt the implementation path.

## P2

- Undo after generated runtime output currently preserves terminal run/thread timeline state, so an undone generated bullet may leave an `outline-output` event in the chat history. This is acceptable for the prototype, but the long-term model should distinguish document undo from chat/event history.
- Late assistant deltas are ignored once a message is marked complete, but a run that completes or fails before `assistant-message-completed` can still leave a streaming message. Later work should either mark open assistant messages terminal on run completion/failure or add provider sequence/event IDs.
- Runtime outline patch dedupe uses `runId + createdAt + patch JSON`. This is enough for the fake runtime, but real providers should send stable event or patch IDs.
