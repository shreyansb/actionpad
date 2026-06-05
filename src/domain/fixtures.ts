import type { BulletNode, OutlineState } from "./types"
import defaultOutlineText from "../outline.txt?raw"
import { createOutlineStateFromPlainText } from "./plainTextOutline"

function bullet(
  id: string,
  text: string,
  parentId: string | null,
  children: string[] = [],
): BulletNode {
  return {
    id,
    parentId,
    children,
    text,
    collapsed: false,
    runStatus: "idle",
    metadata: {},
  }
}

export function createInitialOutlineState(): OutlineState {
  return {
    rootIds: ["root"],
    focusedNodeId: "root",
    selectedThreadId: null,
    chatFocusRequest: 0,
    panelOpen: false,
    threads: {},
    runs: {},
    undoStack: [],
    nodes: {
      root: bullet("root", "", null),
    },
  }
}

export function createDefaultOutlineState(): OutlineState {
  return createOutlineStateFromPlainText(defaultOutlineText)
}

export function createSeededOutlineState(): OutlineState {
  return {
    rootIds: ["root-project"],
    focusedNodeId: "research-products",
    selectedThreadId: null,
    chatFocusRequest: 0,
    panelOpen: false,
    threads: {},
    runs: {},
    undoStack: [],
    nodes: {
      "root-project": bullet("root-project", "Actionpad Prototype", null, [
        "research",
        "ui-exploration",
      ]),
      research: bullet("research", "Research", "root-project", ["research-products"]),
      "research-products": bullet(
        "research-products",
        "Find adjacent products and patterns",
        "research",
      ),
      "ui-exploration": bullet("ui-exploration", "Sketch the first interaction loop", "root-project"),
    },
  }
}
