import { create } from "zustand";

/** Sticky defaults let consecutive adds (a litter) reuse breed/DOB/parents. */
export interface QuickAddDefaults {
  breed?: string;
  dateOfBirth?: string;
  motherId?: string;
  motherTag?: string;
  fatherId?: string;
  fatherTag?: string;
}

interface QuickAddState {
  isOpen: boolean;
  defaults: QuickAddDefaults;
  open: (defaults?: QuickAddDefaults) => void;
  close: () => void;
  setDefaults: (d: QuickAddDefaults) => void;
}

export const useQuickAddStore = create<QuickAddState>((set) => ({
  isOpen: false,
  defaults: {},
  open: (defaults) => set((s) => ({ isOpen: true, defaults: defaults ?? s.defaults })),
  close: () => set({ isOpen: false }),
  setDefaults: (defaults) => set({ defaults }),
}));
