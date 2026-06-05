import { useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { BackupControls } from "./components/BackupControls"
import { OutlineView } from "./components/OutlineView"
import { SidePanel } from "./components/SidePanel"
import type { OutlineState } from "./domain/types"
import type { DocumentPersistence } from "./persistence/documentPersistence"
import { OutlineStoreProvider } from "./store/OutlineStore"

const shortcutGroups = [
  {
    title: "Outline",
    shortcuts: [
      ["Enter", "Create a sibling bullet"],
      ["Tab / Shift + Tab", "Indent or outdent"],
      ["Arrow Up / Down", "Move between bullets"],
      ["Cmd + Arrow Up / Down", "Collapse or expand"],
      ["Option + Arrow Up / Down", "Move a bullet"],
      ["Cmd + Shift + Arrow Up / Down", "Move within the same level"],
      ["Backspace on empty bullet", "Delete the bullet"],
      ["Cmd + Z", "Undo"],
    ],
  },
  {
    title: "Run",
    shortcuts: [
      ["Cmd + Enter", "Run or open chat"],
      ["Esc", "Close panels and menus"],
      ["@", "Mention files and folders"],
      ["Space while dragging", "Pick up or drop a bullet"],
    ],
  },
]

const featureGroups = [
  {
    title: "Executable bullets",
    items: [
      "Run a bullet with Codex and track generated output below it.",
      "Open each bullet's chat thread from the status icon.",
      "Task checkboxes appear on assistant-backed bullets.",
    ],
  },
  {
    title: "Workspace context",
    items: [
      "Mention local files and folders with @ from any bullet.",
      "Open markdown file mentions inline.",
      "Download and import IndexedDB backups from the footer.",
    ],
  },
]

export function App({
  initialState,
  persistence,
  reloadApp = reloadBrowserApp,
}: {
  initialState?: OutlineState
  persistence?: DocumentPersistence | null
  reloadApp?: () => void
}) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.metaKey && !event.altKey && !event.ctrlKey && event.key === "/") {
        event.preventDefault()
        setShortcutsOpen(true)
        return
      }

      if (event.key === "Escape") {
        setShortcutsOpen(false)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  return (
    <OutlineStoreProvider
      initialState={initialState}
      persistence={persistence}
      reloadApp={reloadApp}
    >
      <main className="app-shell">
        <section className="outline-pane">
          <OutlineView />
          <BackupControls />
          <div className="app-branding">
            <a href="https://www.theolabs.org">shreyans bhansali // theolabs, 2026</a>
          </div>
        </section>
        <SidePanel />
      </main>
      {shortcutsOpen ? <ShortcutsModal onClose={() => setShortcutsOpen(false)} /> : null}
    </OutlineStoreProvider>
  )
}

function reloadBrowserApp(): void {
  window.location.reload()
}

function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const previousActiveElement = document.activeElement
    closeButtonRef.current?.focus()

    return () => {
      if (previousActiveElement instanceof HTMLElement) {
        previousActiveElement.focus()
      }
    }
  }, [])

  return (
    <div
      className="shortcuts-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="shortcuts-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-modal-title"
      >
        <header className="shortcuts-modal-header">
          <div>
            <p className="panel-eyebrow">Actionpad</p>
            <h2 id="shortcuts-modal-title">Keyboard shortcuts and features</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="icon-button"
            type="button"
            aria-label="Close shortcuts"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="shortcuts-modal-content">
          <div className="shortcuts-section">
            {shortcutGroups.map((group) => (
              <section key={group.title} className="shortcuts-group">
                <h3>{group.title}</h3>
                <dl>
                  {group.shortcuts.map(([keys, label]) => (
                    <div key={keys} className="shortcut-row">
                      <dt>{keys}</dt>
                      <dd>{label}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
          <div className="features-section">
            {featureGroups.map((group) => (
              <section key={group.title} className="feature-group">
                <h3>{group.title}</h3>
                <ul>
                  {group.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
