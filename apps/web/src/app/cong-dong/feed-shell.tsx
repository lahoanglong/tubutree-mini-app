import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { PAGE_WIDE } from '@/lib/page-frame';

export const FEED_TITLE = 'Cộng đồng Vườn Tubu';
export const FEED_SUBTITLE = 'Hỏi đáp cách dùng, chia sẻ trải nghiệm, cổ vũ nhau 🌿';

/** Khung chung của /cong-dong: dùng cả cho bản server (xem trước công khai trong HTML) lẫn bản client, để hai bên khớp nhau. */
export function FeedShell({ subtitle, children }: { subtitle?: boolean; children: ReactNode }) {
  return (
    <main className={`${PAGE_WIDE} py-6 max-md:pt-0`}>
      <PageHeader title={FEED_TITLE} subtitle={subtitle ? FEED_SUBTITLE : undefined} />
      <div className="mt-3 flex flex-col gap-3 max-md:mt-0 max-md:gap-2">{children}</div>
    </main>
  );
}
