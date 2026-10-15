'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface PdpSelection {
  selectedId: string;
  setSelectedId: (id: string) => void;
}

const Ctx = createContext<PdpSelection | null>(null);

/** Phân loại khách đang chọn dùng chung cho giá đầu trang và nút "Thêm vào giỏ", để hai chỗ luôn ra cùng một giá. */
export function PdpSelectionProvider({ initialId, children }: { initialId: string; children: ReactNode }) {
  const [selectedId, setSelectedId] = useState(initialId);
  const value = useMemo(() => ({ selectedId, setSelectedId }), [selectedId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePdpSelection = () => useContext(Ctx);
