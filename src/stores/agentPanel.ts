import { useSyncExternalStore } from "react";
import { create } from "zustand";

/**
 * docked     right-hand column (default)
 * minimized  collapsed to a slim rail
 * maximized  fills the content area, sidebar stays
 * closed     removed entirely; re-open from the top bar
 *
 * Below DESKTOP_QUERY the panel is never docked: it opens as a bottom sheet
 * (phones) or a right drawer (tablets) driven by `sheetOpen` instead. The
 * sidebar's Agent item opens it full-screen: `maximized` on desktop, the
 * "full" sheet below it (content area only, sidebar stays visible).
 *
 * The mode is mirrored onto <html data-agent> so CSS can lay the panel out and
 * the inline script in app/layout.tsx can restore it before first paint
 * (no docked → closed flash). Keep AGENT_MODES in sync with that script.
 */
export type AgentMode = "docked" | "minimized" | "maximized" | "closed";

export const AGENT_MODES: AgentMode[] = ["docked", "minimized", "maximized", "closed"];
export const AGENT_STORAGE_KEY = "agent-mode";
export const DESKTOP_QUERY = "(min-width: 1280px)";

const isDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;

/** Reactive version of the desktop breakpoint (false during SSR). */
export function useIsDesktop() {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(DESKTOP_QUERY);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    isDesktop,
    () => false
  );
}

function writeMode(mode: AgentMode) {
  document.documentElement.dataset.agent = mode;
  try {
    localStorage.setItem(AGENT_STORAGE_KEY, mode);
  } catch {
    /* private mode: the preference just won't persist */
  }
}

function writeSheet(open: boolean, full: boolean) {
  document.documentElement.dataset.agentSheet = open ? (full ? "full" : "open") : "closed";
}

interface AgentPanelState {
  mode: AgentMode;
  sheetOpen: boolean;
  /** The sheet is the full-screen variant (opened from the sidebar). */
  sheetFull: boolean;
  /** Sync React state from what the pre-paint script already put on <html>. */
  hydrate: () => void;
  setMode: (mode: AgentMode) => void;
  openSheet: (full?: boolean) => void;
  closeSheet: () => void;
  /** Sidebar Agent item: show the agent full-screen, from any state. */
  openFull: () => void;
  /** Leave full-screen (e.g. when navigating) so the page is visible again. */
  leaveFull: () => void;
  /** Top-bar button: open if hidden, hide if showing. */
  toggle: () => void;
  /** The panel's own × button. */
  dismiss: () => void;
}

export const useAgentPanel = create<AgentPanelState>((set, get) => ({
  mode: "docked",
  sheetOpen: false,
  sheetFull: false,
  hydrate: () => {
    const saved = document.documentElement.dataset.agent as AgentMode | undefined;
    if (saved && AGENT_MODES.includes(saved)) set({ mode: saved });
  },
  setMode: (mode) => {
    writeMode(mode);
    set({ mode });
  },
  openSheet: (full = false) => {
    // A sheet only makes sense if the user hasn't removed the agent outright.
    if (get().mode === "closed") get().setMode("docked");
    writeSheet(true, full);
    set({ sheetOpen: true, sheetFull: full });
  },
  closeSheet: () => {
    writeSheet(false, false);
    set({ sheetOpen: false, sheetFull: false });
  },
  openFull: () => {
    if (isDesktop()) get().setMode("maximized");
    else get().openSheet(true);
  },
  leaveFull: () => {
    const { mode, sheetFull, setMode, closeSheet } = get();
    if (isDesktop()) {
      if (mode === "maximized") setMode("docked");
    } else if (sheetFull) {
      closeSheet();
    }
  },
  toggle: () => {
    const { mode, sheetOpen, setMode, openSheet, closeSheet } = get();
    if (isDesktop()) {
      setMode(mode === "docked" || mode === "maximized" ? "closed" : "docked");
    } else if (sheetOpen) {
      closeSheet();
    } else {
      openSheet();
    }
  },
  dismiss: () => {
    if (isDesktop()) get().setMode("closed");
    else get().closeSheet();
  },
}));
