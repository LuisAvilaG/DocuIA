import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False while the server renders and during hydration, true from then on. For
 * text that depends on the visitor's clock or zone ("Hoy 12:40", "hace 5 min"):
 * the server writes it in its own zone (UTC), the browser in the visitor's, and
 * React had to throw the page away and paint it again.
 */
export function useInBrowser(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
