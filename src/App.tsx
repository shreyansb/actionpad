import { createInitialOutlineState } from "./domain/fixtures"

export function App() {
  const initial = createInitialOutlineState()

  return (
    <main className="app-shell">
      <section className="outline-pane">
        <p className="empty-state">
          Executable Outliner V1 · {Object.keys(initial.nodes).length} seed bullets
        </p>
      </section>
    </main>
  )
}
