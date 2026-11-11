'use client';

import { useEffect, useMemo, useRef } from 'react';

/** Số trả về của `mark()` khi lệnh được gửi LÚC TẤM ĐANG ĐÓNG (vd nút ngoài tấm dùng chung lệnh với tấm): lệnh đó không thuộc lần mở nào nên lần đóng muộn của nó chạy như trước. */
export const SHEET_CLOSED_WHEN_SENT = -1;

export interface SheetSeq {
  /**
   * Số lần mở hiện tại của tấm. Gọi lúc GỬI lệnh (trong `onMutate`, ngay khi `mutate` được nhận), giữ kết quả làm context của lệnh.
   * Gửi lúc tấm đang đóng thì trả `SHEET_CLOSED_WHEN_SENT`.
   */
  mark: () => number;
  /**
   * Số lần mở thô, không có mã "đóng lúc gửi". Dùng khi lệnh không xuất phát từ tấm này nhưng muốn biết tấm này có được mở lại sau lúc gửi không.
   * Đưa kết quả vào `isCurrent` lúc đóng.
   */
  count: () => number;
  /** Lệnh gửi ở lần mở `sent` có còn đúng là lần mở hiện tại không. Chạy lúc ĐÓNG hoặc lúc xoá chữ (sau khi chờ), không chạy lúc gửi. */
  isCurrent: (sent: number | undefined) => boolean;
}

/**
 * Số lần mở của một tấm/hộp. Phản hồi muộn của lệnh gửi từ lần mở trước (máy chủ báo xong hoặc từ chối sau khi khách tự đóng tấm rồi mở lại và đang gõ dở)
 * không được đóng tấm mới mở hay xoá chữ đang gõ: lệnh mang số của lần mở đã gửi nó và chỉ đóng/xoá khi số đó vẫn là số hiện tại.
 *
 * `openKey` cho biết tấm đang mở: boolean `open`, hoặc mã đích của tấm (`row?.id`, `null` khi đóng). Số tăng mỗi khi `openKey` chuyển sang giá trị thật
 * (đóng → mở, hoặc đổi sang đích khác); đóng lại không làm số tăng, nên lệnh gửi rồi tấm đóng mà không ai mở lại vẫn đóng như thường.
 * Hai lần mở liền nhau cùng một đích phải có một lần vẽ ở trạng thái đóng chen giữa (đúng với mọi tấm đóng/mở qua state).
 * Giống `apps/miniapp/src/hooks/use-sheet-seq.ts`.
 */
export function useSheetSeq(openKey: unknown): SheetSeq {
  const seq = useRef(0);
  const open = useRef(false);
  useEffect(() => {
    open.current = Boolean(openKey);
    if (openKey) seq.current += 1;
  }, [openKey]);
  return useMemo(
    () => ({
      mark: () => (open.current ? seq.current : SHEET_CLOSED_WHEN_SENT),
      count: () => seq.current,
      isCurrent: (sent) => sent === SHEET_CLOSED_WHEN_SENT || sent === seq.current,
    }),
    [],
  );
}
