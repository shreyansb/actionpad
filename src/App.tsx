import { OutlineView } from "./components/OutlineView"
import { SidePanel } from "./components/SidePanel"
import type { OutlineState } from "./domain/types"
import { OutlineStoreProvider } from "./store/OutlineStore"

export function App({ initialState }: { initialState?: OutlineState }) {
  return (
    <OutlineStoreProvider initialState={initialState}>
      <main className="app-shell">
        <section className="outline-pane">
          <OutlineView />
        </section>
        <SidePanel />
      </main>
    </OutlineStoreProvider>
  )
}
