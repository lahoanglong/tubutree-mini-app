import { ChevronDown } from 'lucide-react';
import { WASTE_FAQ_TITLE, type WasteFaqItem } from '@tubutree/app-core/waste-faq';
import { skin } from '@/components/pro-shared/mini-skin';

/**
 * Câu hỏi thường gặp của trang Đổi rác, dựng ở máy chủ. Mọi câu trả lời có sẵn trong HTML (khớp đúng FAQPage của trang); mở/đóng bằng
 * `<details>` nên không thêm JS cho client. Hàng gọn cùng nhịp với FAQ ở trang Về Tubu Tree: tiêu đề chạm được cao tối thiểu 44px.
 */
export function RecycleFaq({ items }: { items: readonly WasteFaqItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="recycle-faq-title" className="space-y-2">
      <h2 id="recycle-faq-title" className={skin.sectionTitle}>
        {WASTE_FAQ_TITLE}
      </h2>
      <div className={`px-4 ${skin.card}`}>
        {items.map((f, i) => (
          <details key={f.q} className={`group${i < items.length - 1 ? ' border-b border-stone-200' : ''}`}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 py-3 text-left [&::-webkit-details-marker]:hidden">
              <span className="flex-1 text-sm font-semibold text-stone-900">{f.q}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-stone-500 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <p className="pb-3 text-sm text-stone-700">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
