export function ChatInput() {
  return (
    <form className="chat-input" onSubmit={(event) => event.preventDefault()}>
      <textarea aria-label="Chat input" placeholder="Ask a follow-up..." rows={2} />
      <button type="submit">Send</button>
    </form>
  )
}
