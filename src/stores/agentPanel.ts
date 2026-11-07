import { create } from "zustand";

/**
 * docked     right-hand column (default)
 * minimized  collapsed to a slim rail
 * maximized  fills the content area, sidebar stays
 * closed     removed entirely; re-open from the top bar
 *
 * Below DESKTOP_QUERY the panel is never docked: it opens as a bottom sheet
 * (phones) or a right drawer (tablets) driven by `sheetOpen` instead.
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

function writeMode(mode: AgentMode) {
  document.documentElement.dataset.agent = mode;
  try {
    localStorage.setItem(AGENT_STORAGE_KEY, mode);
  } catch {
    /* private mode: the preference just won't persist */
  }
}

function writeSheet(open: boolean) {
  document.documentElement.dataset.agentSheet = open ? "open" : "closed";
}

interface AgentPanelState {
  mode: AgentMode;
  sheetOpen: boolean;
  /** Sync React state from what the pre-paint script already put on <html>. */
  hydrate: () => void;
  setMode: (mode: AgentMode) => void;
  openSheet: () => void;
  closeSheet: () => void;
  /** Top-bar button: open if hidden, hide if showing. */
  toggle: () => void;
  /** The panel's own × button. */
  dismiss: () => void;
}

export const useAgentPanel = create<AgentPanelState>((set, get) => ({
  mode: "docked",
  sheetOpen: false,
  hydrate: () => {
    const saved = document.documentElement.dataset.agent as AgentMode | undefined;
    if (saved && AGENT_MODES.includes(saved)) set({ mode: saved });
  },
  setMode: (mode) => {
    writeMode(mode);
    set({ mode });
  },
  openSheet: () => {
    // A sheet only makes sense if the user hasn't removed the agent outright.
    if (get().mode === "closed") get().setMode("docked");
    writeSheet(true);
    set({ sheetOpen: true });
  },
  closeSheet: () => {
    writeSheet(false);
    set({ sheetOpen: false });
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
