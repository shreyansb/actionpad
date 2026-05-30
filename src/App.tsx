import { OutlineStoreProvider } from "./store/OutlineStore"

export function App() {
  return (
    <OutlineStoreProvider>
      <main className="app-shell">
        <section className="outline-pane">
          <p className="empty-state">Executable Outliner V1</p>
        </section>
      </main>
    </OutlineStoreProvider>
  )
}
