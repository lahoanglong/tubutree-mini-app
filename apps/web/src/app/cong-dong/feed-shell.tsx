import type { ReactNode } from 'react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { PageHeader } from '@/components/ui/page-header';
import { ui } from '@/lib/guest-ui';
import { PAGE_NARROW_UNTIL_LG } from '@/lib/page-frame';

export const FEED_TITLE = 'Cộng đồng Vườn Tubu';
export const FEED_SUBTITLE = 'Hỏi đáp cách dùng, chia sẻ trải nghiệm, cổ vũ nhau 🌿';

const GUIDE_KEYS = ['community.guideAsk', 'community.guideTag', 'community.guideUnanswered'] as const;

/**
 * Cột phụ của máy tính (từ lg): mẹo dùng cộng đồng, chỉ chữ tĩnh nên giống nhau ở bản server (xem trước công khai) và bản client.
 * Ẩn dưới lg để điện thoại và Mini App không đổi; dính dưới thanh đầu trang khi cuộn bảng tin dài.
 */
function FeedAside() {
  return (
    <aside
      data-testid="feed-aside"
      aria-label={fillCopy('community.guideTitle')}
      className="hidden lg:sticky lg:top-[calc(var(--header-h)+1rem)] lg:col-span-4 lg:mt-3 lg:block"
    >
      <div className={`${ui.card} p-4`}>
        <h2 className="font-display text-base font-semibold text-stone-900">{fillCopy('community.guideTitle')}</h2>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-stone-700">
          {GUIDE_KEYS.map((key) => (
            <li key={key}>{fillCopy(key)}</li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

/**
 * Khung chung của /cong-dong: dùng cả cho bản server (xem trước công khai trong HTML) lẫn bản client, để hai bên khớp nhau.
 * Từ lg là lưới 12 cột: bảng tin 8 cột, cột phụ 4 cột bên phải; thứ tự DOM là thứ tự của Mini (bảng tin trước), cột phụ chỉ xuất hiện từ lg.
 */
export function FeedShell({ subtitle, children }: { subtitle?: boolean; children: ReactNode }) {
  return (
    <main className={`${PAGE_NARROW_UNTIL_LG} py-6 max-md:pt-0`}>
      <PageHeader title={FEED_TITLE} subtitle={subtitle ? FEED_SUBTITLE : undefined} />
      <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">
        <div className="mt-3 flex flex-col gap-3 max-md:mt-0 max-md:gap-2 lg:col-span-8 lg:min-w-0">{children}</div>
        <FeedAside />
      </div>
    </main>
  );
}
