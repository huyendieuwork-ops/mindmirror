import { pref, setPref } from "./data";

export type Theme = "light" | "dark" | "system";

export function applyTheme(t: Theme = pref<Theme>("theme", "light")) {
  const el = document.documentElement;
  if (t === "system") delete el.dataset.theme;
  else el.dataset.theme = t;
}

export function saveTheme(t: Theme) {
  setPref("theme", t);
  applyTheme(t);
}
