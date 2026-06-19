import { useEffect, useLayoutEffect, useRef, useState } from "react"

type ChatInputProps = {
  autoFocusKey: string | null
  disabled?: boolean
  draftKey?: string | null
  onSubmit: (message: string) => void
}

function toStorageKey(draftKey: string | null | undefined): string | null {
  return draftKey ? `actionpad:chat-draft:${draftKey}` : null
}

function readStoredDraft(storageKey: string | null): string {
  if (!storageKey) return ""
  try {
    return window.localStorage.getItem(storageKey) ?? ""
  } catch {
    return ""
  }
}

function writeStoredDraft(storageKey: string | null, message: string) {
  if (!storageKey) return
  try {
    if (message) {
      window.localStorage.setItem(storageKey, message)
    } else {
      window.localStorage.removeItem(storageKey)
    }
  } catch {
    // Draft persistence is best effort; typing should keep working if storage is unavailable.
  }
}

export function ChatInput({ autoFocusKey, disabled = false, draftKey, onSubmit }: ChatInputProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const storageKey = toStorageKey(draftKey)
  const [message, setMessage] = useState(() => readStoredDraft(storageKey))

  useEffect(() => {
    setMessage(readStoredDraft(storageKey))
  }, [storageKey])

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = "auto"
    input.style.height = `${input.scrollHeight}px`
  }, [message])

  useEffect(() => {
    if (autoFocusKey) inputRef.current?.focus()
  }, [autoFocusKey])

  const submitMessage = () => {
    const trimmed = message.trim()
    if (!trimmed || disabled) return
    onSubmit(trimmed)
    setMessage("")
    writeStoredDraft(storageKey, "")
  }

  return (
    <form
      className="chat-input"
      onSubmit={(event) => {
        event.preventDefault()
        submitMessage()
      }}
    >
      <textarea
        ref={inputRef}
        aria-label="Chat input"
        placeholder="Ask a follow-up..."
        rows={2}
        value={message}
        readOnly={disabled}
        onChange={(event) => {
          const nextMessage = event.currentTarget.value
          setMessage(nextMessage)
          writeStoredDraft(storageKey, nextMessage)
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !event.metaKey) return
          event.preventDefault()
          submitMessage()
        }}
      />
      <button type="submit" disabled={disabled || !message.trim()}>
        Send
      </button>
    </form>
  )
}
