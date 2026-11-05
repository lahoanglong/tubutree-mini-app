'use client';

import { createContext, useContext, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type ReactNode, type SetStateAction } from 'react';

interface PdpSelection {
  selectedId: string;
  setSelectedId: (id: string) => void;
  quantity: number;
  setQuantity: Dispatch<SetStateAction<number>>;
  /** Khách đã tự chọn phân loại (chip, bảng chọn, vòng cung câu chuyện): tồn kho và Giờ vàng về muộn không được đổi phân loại dưới tay họ. */
  userPicked: MutableRefObject<boolean>;
  /** Khối mua báo có mua được phân loại đang chọn không (còn hàng, gian hàng không tạm nghỉ). null khi khối mua chưa báo. */
  buyable: boolean | null;
  setBuyable: (v: boolean) => void;
}

const Ctx = createContext<PdpSelection | null>(null);

/**
 * Phân loại và số lượng khách đang chọn dùng chung cho giá đầu trang, nút "Thêm vào giỏ" và sheet Đặt định kỳ, để các chỗ luôn ra
 * cùng một giá và cùng một số lượng.
 */
export function PdpSelectionProvider({ initialId, children }: { initialId: string; children: ReactNode }) {
  const [selectedId, setSelectedId] = useState(initialId);
  const [quantity, setQuantity] = useState(1);
  const [buyable, setBuyable] = useState<boolean | null>(null);
  const userPicked = useRef(false);
  const value = useMemo(() => ({ selectedId, setSelectedId, quantity, setQuantity, userPicked, buyable, setBuyable }), [selectedId, quantity, buyable]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePdpSelection = () => useContext(Ctx);
