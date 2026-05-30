import { useEffect, useRef } from "react"

type ChatInputProps = {
  autoFocusKey: string | null
}

export function ChatInput({ autoFocusKey }: ChatInputProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (autoFocusKey) inputRef.current?.focus()
  }, [autoFocusKey])

  return (
    <form className="chat-input" onSubmit={(event) => event.preventDefault()}>
      <textarea
        ref={inputRef}
        aria-label="Chat input"
        placeholder="Ask a follow-up..."
        rows={2}
        readOnly
      />
      <button type="submit" disabled>
        Send
      </button>
    </form>
  )
}
