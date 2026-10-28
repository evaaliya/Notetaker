import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type Ctx = {
  open: boolean;
  show: () => void;
  hide: () => void;
};

const QuickAddContext = createContext<Ctx | null>(null);

export function QuickAddProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(
    () => ({
      open,
      show: () => setOpen(true),
      hide: () => setOpen(false),
    }),
    [open],
  );
  return <QuickAddContext.Provider value={value}>{children}</QuickAddContext.Provider>;
}

export function useQuickAdd(): Ctx {
  const ctx = useContext(QuickAddContext);
  if (!ctx) throw new Error("useQuickAdd outside provider");
  return ctx;
}
