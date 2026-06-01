import { OutlineView } from "./components/OutlineView"
import { SidePanel } from "./components/SidePanel"
import type { OutlineState } from "./domain/types"
import type { DocumentPersistence } from "./persistence/documentPersistence"
import { OutlineStoreProvider } from "./store/OutlineStore"

export function App({
  initialState,
  persistence,
}: {
  initialState?: OutlineState
  persistence?: DocumentPersistence | null
}) {
  return (
    <OutlineStoreProvider initialState={initialState} persistence={persistence}>
      <main className="app-shell">
        <section className="outline-pane">
          <OutlineView />
          <div className="app-branding">
            <a href="https://www.theolabs.org">shreyans bhansali // theolabs, 2026</a>
          </div>
        </section>
        <SidePanel />
      </main>
    </OutlineStoreProvider>
  )
}
