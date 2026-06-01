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
          <div className="app-branding">
            made by shreyans @ <a href="https://theolabs.org">theolabs.org</a>
          </div>
          <OutlineView />
        </section>
        <SidePanel />
      </main>
    </OutlineStoreProvider>
  )
}
