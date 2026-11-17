'use client';

// Nguồn: apps/miniapp/src/components/loyalty/loyalty-rules-card.tsx
import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { ui } from '@/lib/guest-ui';
import { miniCard, miniSectionTitle } from './mini-surface';

/**
 * Mục gập "Cách kiếm và dùng Điểm Xanh" của trang Điểm Xanh: đóng mặc định để thẻ hạng gọn, mở ra là các dòng luật tích và dùng điểm (theo cấu hình API).
 * Nút nằm trong h2 (mẫu accordion) để mục vẫn có trong danh sách tiêu đề của trang. Không có dòng nào (API cũ chưa trả tỷ lệ) thì không vẽ.
 */
export function LoyaltyRulesCard({ lines, className = '' }: { lines: readonly string[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  if (lines.length === 0) return null;
  const title = fillCopy('loyalty.rulesTitle');
  return (
    <section aria-label={title} className={`${miniCard} ${className}`}>
      <h2 className={`${ui.sectionTitle} ${miniSectionTitle}`}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          className="tubu-press flex min-h-11 w-full items-center justify-between gap-2 p-4 text-left"
        >
          <span className="min-w-0">{title}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-stone-500 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </h2>
      <div id={bodyId} hidden={!open} className="space-y-1 px-4 pb-4 text-sm text-stone-700">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </section>
  );
}
