import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface UiState {
  paletteOpen: boolean;
  setPaletteOpen: (o: boolean) => void;
  newJobOpen: boolean;
  setNewJobOpen: (o: boolean) => void;
}

const Ctx = createContext<UiState | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newJobOpen, setNewJobOpen] = useState(false);
  const value = useMemo(() => ({ paletteOpen, setPaletteOpen, newJobOpen, setNewJobOpen }), [paletteOpen, newJobOpen]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUi() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useUi must be used inside UiProvider");
  return c;
}
