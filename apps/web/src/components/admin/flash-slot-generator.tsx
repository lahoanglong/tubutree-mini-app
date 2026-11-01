'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { generateFlashSlots } from '@/lib/admin-client';
import { BTN_SECONDARY } from './ui';

export const SLOT_GENERATE_DAYS = 2;

/** Câu báo sau khi sinh khung: nói rõ cả số đã có sẵn để bấm lần hai không bị hiểu là lỗi. */
export function generatedText(r: { created: number; skipped: number }): string {
  return `Đã tạo ${r.created} khung, bỏ qua ${r.skipped}.`;
}

/**
 * Nút sinh các khung Giờ vàng mặc định (khoá `flashsale.slots`, giờ Việt Nam) cho vài ngày tới, để không phải tạo tay từng đợt.
 * Đợt sinh ra rỗng: thêm món vào từng đợt như đợt tạo tay.
 */
export function FlashSlotGenerator({ onDone }: { onDone: () => void }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const gen = useMutation({
    mutationFn: () => generateFlashSlots(SLOT_GENERATE_DAYS),
    onSuccess: (r) => {
      setMsg({ ok: true, text: generatedText(r) });
      onDone();
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Không tạo được khung giờ' }),
  });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setMsg(null);
            gen.mutate();
          }}
          disabled={gen.isPending}
          className={BTN_SECONDARY}
        >
          {gen.isPending ? 'Đang tạo…' : `Tạo khung giờ ${SLOT_GENERATE_DAYS} ngày tới`}
        </button>
        <p className="min-w-0 basis-64 grow text-xs text-stone-600">
          Tạo đợt rỗng 2 giờ theo các mốc mặc định (khoá flashsale.slots ở tab Cấu hình, giờ Việt Nam). Mốc đã có đợt hoặc đã bắt đầu thì bỏ qua.
        </p>
      </div>
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`mt-2 text-sm ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
