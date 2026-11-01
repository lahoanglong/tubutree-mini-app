'use client';

import { useEffect, useRef, useState } from 'react';
import type { SectionStyle } from '@tubutree/app-core/commerce/storefront-builder';

export type SectionLayout = 'GRID' | 'CAROUSEL' | 'STACK';

const SEND_DELAY_MS = 300;
const RETRY_MS = 150;

export interface SectionStyleDeps {
  send: (v: { id: string; layout: SectionLayout }) => void;
  isPending: () => boolean;
  /** Kiểu khối đang có trong dữ liệu (đã lưu), null nếu không còn khối đó. */
  currentOf: (id: string) => SectionStyle | null;
}

/**
 * Chọn kiểu hiển thị của khối. Mũi tên trên bộ chọn đổi ô ngay mỗi lần bấm, nên mỗi lần bấm không được là một lần ghi:
 * ô vừa chọn hiện ngay (`picked`), chỉ ô cuối cùng được gửi sau một nhịp, và không gửi chồng lên lần ghi trước chưa xong
 * (hai lần ghi chạy song song thì lần trả lời sau cùng quyết định kiểu cuối). Rời màn trước khi gửi thì gửi nốt.
 */
export function useSectionStyle(deps: SectionStyleDeps) {
  const [picked, setPicked] = useState<{ id: string; style: SectionStyle } | null>(null);
  const d = useRef(deps);
  d.current = deps;
  const queued = useRef<{ id: string; layout: SectionLayout } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearPicked = (id: string, style: SectionStyle) => setPicked((p) => (p && p.id === id && p.style === style ? null : p));

  const flush = () => {
    const q = queued.current;
    if (!q) return;
    if (d.current.isPending()) {
      timer.current = setTimeout(flush, RETRY_MS);
      return;
    }
    queued.current = null;
    if (d.current.currentOf(q.id) === q.layout) {
      clearPicked(q.id, q.layout);
      return;
    }
    d.current.send(q);
  };

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      const q = queued.current;
      if (q && !d.current.isPending()) d.current.send(q);
    },
    [],
  );

  return {
    picked,
    choose(id: string, layout: SectionLayout) {
      clearTimeout(timer.current);
      queued.current = { id, layout };
      setPicked({ id, style: layout });
      timer.current = setTimeout(flush, SEND_DELAY_MS);
    },
    /** Lần ghi `layout` của khối `id` đã xong (thành công hay lỗi): bỏ ô chọn tạm, bộ chọn đọc lại từ dữ liệu. */
    settled: clearPicked,
  };
}
