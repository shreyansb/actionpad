import type { BulletNode, OutlineState } from "./types"

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
    rootIds: ["root-project"],
    focusedNodeId: "research-products",
    selectedThreadId: null,
    chatFocusRequest: 0,
    panelOpen: false,
    threads: {},
    lastDeletedNode: null,
    nodes: {
      "root-project": bullet("root-project", "Executable Outliner Prototype", null, [
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
