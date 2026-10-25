import { useSyncExternalStore } from 'react';

/**
 * Cổng nhận quà thẻ (CouponClaimGate) và màn tích điểm đơn sàn là hai nơi riêng: khi quà thẻ không dùng được cho khách cũ,
 * cổng không mở sheet lỗi trên màn tích điểm mà để lại ghi chú này cho màn hiện một dòng nhẹ.
 */
export type CardGiftNote = 'new-customers-only' | null;

let note: CardGiftNote = null;
const listeners = new Set<() => void>();

export function setCardGiftNote(next: CardGiftNote): void {
  if (note === next) return;
  note = next;
  listeners.forEach((l) => l());
}

export function getCardGiftNote(): CardGiftNote {
  return note;
}

export function useCardGiftNote(): CardGiftNote {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getCardGiftNote,
    getCardGiftNote,
  );
}
