import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getPreviewProduct } from '@/lib/api';
import { formatDateTime } from '@/lib/format-date';
import { PREVIEW_COPY } from './preview-copy';
import { PreviewNotice } from './preview-notice';
import { PreviewProduct } from './preview-product';

/** Không lập chỉ mục, không theo link (thêm X-Robots-Tag ở next.config cho chắc với bot không đọc thẻ meta). */
export const previewMetadata: Metadata = {
  title: PREVIEW_COPY.pageTitle,
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Băng cố định đầu trang: người soạn luôn biết đây là bản nháp, kể cả khi đã cuộn xuống phần mô tả. */
export function PreviewBanner({ preview }: { preview?: { version: number; expiresAt: string } }) {
  return (
    <div
      data-testid="preview-banner"
      role="note"
      aria-label={PREVIEW_COPY.banner}
      className="sticky top-0 z-40 flex flex-wrap items-baseline gap-x-2 bg-warning-bg px-4 py-2 text-sm text-warning-fg"
    >
      <strong className="font-semibold tracking-wide">{PREVIEW_COPY.banner}</strong>
      <span>{PREVIEW_COPY.bannerNote}</span>
      {preview && (
        <span className="tabular-nums">
          {PREVIEW_COPY.bannerVersion.replace('{v}', String(preview.version)).replace('{t}', formatDateTime(preview.expiresAt))}
        </span>
      )}
    </div>
  );
}

/**
 * `frame=miniapp`: khung rộng tối đa 390px giữa màn (MSS đặt iframe khổ điện thoại; Mini App thật không nhúng được vào iframe, đây là web khổ điện thoại).
 * Các thành phần PDP đổi bố cục theo khổ màn hình chứ không theo khung, nên iframe của MSS phải rộng đúng khổ điện thoại để ra bố cục điện thoại.
 */
function PreviewFrame({ frame, children }: { frame: 'miniapp' | 'web'; children: ReactNode }) {
  return (
    <main data-page-bleed data-preview-frame={frame} className={frame === 'miniapp' ? 'mx-auto w-full max-w-[24.375rem]' : 'mx-auto w-full max-w-frame md:px-6 md:pb-6'}>
      {children}
    </main>
  );
}

/**
 * Trang xem trước nội dung nháp MSS (hợp đồng mục 1.5): `/san-pham/_preview?token=…&frame=miniapp|web` (đường MSS nhúng) và
 * `/san-pham/_preview/<slug>?token=…` (slug chỉ để đọc, sản phẩm lấy theo token). Token thiếu, sai hoặc hết hạn, sản phẩm chưa có trên Tubu,
 * MSS chưa trả được bản nháp: báo ngay trong trang, giữ khung `frame`. Không dùng notFound(): trang động gọi notFound() ra HTML 404 rỗng
 * (thông báo chỉ nằm trong dữ liệu RSC), iframe của MSS sẽ trắng nếu JS chưa chạy xong; trang đã có noindex và no-store nên mã 200 không lọt chỉ mục.
 */
export async function PreviewPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const token = first(params.token)?.trim();
  const frame = first(params.frame) === 'miniapp' ? 'miniapp' : 'web';
  const result = token ? await getPreviewProduct(token) : ({ kind: 'expired' } as const);
  return (
    <PreviewFrame frame={frame}>
      <PreviewBanner preview={result.kind === 'ok' ? result.preview : undefined} />
      {result.kind === 'ok' ? <PreviewProduct product={result.product} /> : <PreviewNotice problem={result.kind} />}
    </PreviewFrame>
  );
}
