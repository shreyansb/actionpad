import { useEffect, useRef, useState } from "react"

type ChatInputProps = {
  autoFocusKey: string | null
  disabled?: boolean
  onSubmit: (message: string) => void
}

export function ChatInput({ autoFocusKey, disabled = false, onSubmit }: ChatInputProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const [message, setMessage] = useState("")

  useEffect(() => {
    if (autoFocusKey) inputRef.current?.focus()
  }, [autoFocusKey])

  return (
    <form
      className="chat-input"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = message.trim()
        if (!trimmed || disabled) return
        onSubmit(trimmed)
        setMessage("")
      }}
    >
      <textarea
        ref={inputRef}
        aria-label="Chat input"
        placeholder="Ask a follow-up..."
        rows={2}
        value={message}
        readOnly={disabled}
        onChange={(event) => setMessage(event.currentTarget.value)}
      />
      <button type="submit" disabled={disabled || !message.trim()}>
        Send
      </button>
    </form>
  )
}
