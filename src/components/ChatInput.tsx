import { useEffect, useRef } from "react"
import type { KeyboardEvent } from "react"

type ChatInputProps = {
  autoFocusKey: string | null
  onClosePanel: () => void
}

export function ChatInput({ autoFocusKey, onClosePanel }: ChatInputProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (autoFocusKey) inputRef.current?.focus()
  }, [autoFocusKey])

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.metaKey && event.key === "ArrowLeft") {
      event.preventDefault()
      onClosePanel()
    }
  }

  return (
    <form className="chat-input" onSubmit={(event) => event.preventDefault()}>
      <textarea
        ref={inputRef}
        aria-label="Chat input"
        placeholder="Ask a follow-up..."
        rows={2}
        readOnly
        onKeyDown={handleKeyDown}
      />
      <button type="submit" disabled>
        Send
      </button>
    </form>
  )
}
