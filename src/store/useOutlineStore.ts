import { useContext } from "react"
import { OutlineStoreContext, type OutlineStoreValue } from "./OutlineStoreContext"

export function useOutlineStore(): OutlineStoreValue {
  const value = useContext(OutlineStoreContext)
  if (!value) {
    throw new Error("useOutlineStore must be used inside OutlineStoreProvider")
  }
  return value
}
