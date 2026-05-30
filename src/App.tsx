import { OutlineView } from "./components/OutlineView"
import { OutlineStoreProvider } from "./store/OutlineStore"

export function App() {
  return (
    <OutlineStoreProvider>
      <main className="app-shell">
        <section className="outline-pane">
          <OutlineView />
        </section>
      </main>
    </OutlineStoreProvider>
  )
}
