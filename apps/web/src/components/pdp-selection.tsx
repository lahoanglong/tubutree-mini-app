'use client';

import { createContext, useContext, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';

interface PdpSelection {
  selectedId: string;
  setSelectedId: (id: string) => void;
  quantity: number;
  setQuantity: Dispatch<SetStateAction<number>>;
}

const Ctx = createContext<PdpSelection | null>(null);

/**
 * Phân loại và số lượng khách đang chọn dùng chung cho giá đầu trang, nút "Thêm vào giỏ" và sheet Đặt định kỳ, để các chỗ luôn ra
 * cùng một giá và cùng một số lượng.
 */
export function PdpSelectionProvider({ initialId, children }: { initialId: string; children: ReactNode }) {
  const [selectedId, setSelectedId] = useState(initialId);
  const [quantity, setQuantity] = useState(1);
  const value = useMemo(() => ({ selectedId, setSelectedId, quantity, setQuantity }), [selectedId, quantity]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePdpSelection = () => useContext(Ctx);
