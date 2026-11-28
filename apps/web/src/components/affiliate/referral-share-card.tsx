'use client';

import { useRef, useState } from 'react';
import { Copy, Share2 } from 'lucide-react';
import { CTV_SHARE_CARD_COPY, ctvReferralPath, ctvReferralUrl, ctvShareOfferLine, type CtvShareMetric } from '@tubutree/app-core/commerce/ctv-share-card';
import { shareDescription, type WelcomeOffer } from '@tubutree/app-core/commerce/share-offer';
import { platformBridge } from '@/lib/platform-bridge';
import { SITE_URL } from '@/lib/site';
import { ui } from '@/lib/guest-ui';
import { phoneCaption, phoneCode } from '@/lib/phone-ui';
import { Skeleton } from '@/components/ui/skeleton';

/** Cao đủ cho một số + nhãn hai dòng ở 320px: khung chờ và số thật cùng chiều cao, trang không nhảy khi số về. */
const TILE = 'min-h-14 min-w-0';
const STRIP = 'mt-3 grid grid-cols-3 gap-2';

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Thẻ chia sẻ của CTV ở tab Chia sẻ của /ctv (cùng nội dung với `ReferralShareCard` của Mini App): mã, ưu đãi khách mới, ba số, hai nút một chạm.
 * "Chia sẻ Zalo" mở hộp chia sẻ của trình duyệt (Web Share API; máy không có thì chép link); mã giới thiệu đi kèm ở cả hai lối.
 * Chưa có mã thì không có nút nào: link thiếu mã không tính hoa hồng cho CTV.
 */
export function ReferralShareCard({
  code,
  offer,
  caption,
  title,
  metrics,
  metricsLoading,
  onNote,
}: {
  code: string;
  offer: WelcomeOffer | null;
  caption: string;
  title: string;
  /** Null + `metricsLoading` = khung chờ; null không chờ (lỗi tải) = không vẽ dải số. */
  metrics: CtvShareMetric[] | null;
  metricsLoading?: boolean;
  /** Báo kết quả ra vùng thông báo của trang (thành công đọc lịch sự, lỗi là `alert`). */
  onNote: (text: string, error: boolean) => void;
}) {
  const path = ctvReferralPath(code);
  const url = ctvReferralUrl(SITE_URL, code);
  // Hai cú bấm sát nhau không gọi lặp hộp chia sẻ hay clipboard; `aria-disabled` thay vì `disabled` để nút đang focus không mất focus.
  const lockRef = useRef(false);
  const [active, setActive] = useState<'share' | 'copy' | null>(null);
  const run = async (kind: 'share' | 'copy', task: () => Promise<void>) => {
    if (lockRef.current) return;
    lockRef.current = true;
    setActive(kind);
    try {
      await task();
    } finally {
      lockRef.current = false;
      setActive(null);
    }
  };

  const share = () =>
    run('share', async () => {
      if (!path) return;
      const result = await platformBridge.share({ title, text: shareDescription(caption, offer), path });
      if (result === 'copied') onNote(CTV_SHARE_CARD_COPY.copied, false);
      else if (result === 'failed') onNote(CTV_SHARE_CARD_COPY.copyFail, true);
    });
  const copy = () =>
    run('copy', async () => {
      if (!url) return;
      const ok = await copyToClipboard(url);
      onNote(ok ? CTV_SHARE_CARD_COPY.copied : CTV_SHARE_CARD_COPY.copyFail, !ok);
    });

  return (
    <div data-testid="ctv-share-card">
      <div className="rounded-control bg-forest-50 p-3">
        <div data-testid="ctv-share-code" className={`break-all font-display text-xl font-semibold tabular-nums tracking-wide text-forest-700 ${phoneCode}`}>
          {code}
        </div>
        <div data-testid="ctv-share-offer" className={`mt-1 text-xs text-stone-700 ${phoneCaption}`}>
          {ctvShareOfferLine(offer)}
        </div>
      </div>

      {(metrics || metricsLoading) && (
        <>
          {metrics ? (
            <div role="group" aria-label={CTV_SHARE_CARD_COPY.metricsLabel} data-testid="ctv-metric-strip" className={STRIP}>
              {metrics.map((m) => (
                <div key={m.key} data-testid={`ctv-metric-${m.key}`} className={TILE}>
                  <div className="break-words text-base font-semibold tabular-nums text-stone-900">{m.value}</div>
                  <div className={`text-xs text-stone-600 ${phoneCaption}`}>{m.label}</div>
                </div>
              ))}
            </div>
          ) : (
            <div role="status" aria-label="Đang tải số liệu" className={STRIP}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={56} />
              ))}
            </div>
          )}
          <p className={`mt-1 text-xs text-stone-600 ${phoneCaption}`}>{CTV_SHARE_CARD_COPY.metricsScope}</p>
        </>
      )}

      {url && (
        <div className="mt-3 flex flex-col gap-2">
          <button type="button" className={ui.btnPrimary} aria-disabled={active !== null || undefined} aria-busy={active === 'share' || undefined} onClick={() => void share()}>
            <Share2 className="mr-1.5 h-4 w-4 flex-none" aria-hidden="true" />
            {CTV_SHARE_CARD_COPY.shareZalo}
          </button>
          <button type="button" className={ui.btnSecondary} aria-disabled={active !== null || undefined} onClick={() => void copy()}>
            <Copy className="mr-1.5 h-4 w-4 flex-none" aria-hidden="true" />
            {CTV_SHARE_CARD_COPY.copyLink}
          </button>
        </div>
      )}
    </div>
  );
}
