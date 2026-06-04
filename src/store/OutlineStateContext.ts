import { createContext, useContext } from "react"
import type { OutlineState } from "../domain/types"

export const OutlineStateContext = createContext<OutlineState | null>(null)

export function useOutlineState(): OutlineState {
  const value = useContext(OutlineStateContext)
  if (!value) throw new Error("useOutlineState must be used inside OutlineStoreProvider")
  return value
}
