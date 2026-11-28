import type { CSSProperties } from 'react';
import { Copy, Share2 } from 'lucide-react';
import { useSnackbar } from 'zmp-ui';
import { CTV_SHARE_CARD_COPY, ctvReferralPath, ctvShareOfferLine, type CtvShareMetric } from '@tubutree/app-core/commerce/ctv-share-card';
import { shareDescription, type WelcomeOffer } from '@tubutree/app-core/commerce/share-offer';
import { haptic } from '../../utils/haptic';
import { copyText } from '../../utils/clipboard';
import { miniAppLink } from '../../utils/miniapp-link';
import { useActionLock, useShareWithFallback } from '../share-sheet';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { Text } from '../ui/text';

const STRIP: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 'var(--space-stack-sm)',
  marginTop: 'var(--space-inset-card)',
};

/** Cao đủ cho một số + nhãn hai dòng ở 320px: khung chờ và số thật cùng chiều cao, trang không nhảy khi số về. */
const TILE_MIN_HEIGHT = 56;

/**
 * Thẻ chia sẻ của CTV ở tab Chia sẻ: mã, ưu đãi khách mới, ba số, hai nút một chạm. Mã giới thiệu đi kèm ở CẢ HAI lối (chia sẻ Zalo và chép link),
 * như `ShareSheet`: khách mở link thiếu mã thì CTV không được tính hoa hồng. Chưa có mã thì không có nút nào.
 */
export function ReferralShareCard({
  code,
  offer,
  caption,
  title,
  metrics,
  metricsLoading,
}: {
  code: string;
  offer: WelcomeOffer | null;
  /** Lời đăng kèm thẻ Zalo (dòng ưu đãi đứng đầu, `shareDescription`). */
  caption: string;
  title: string;
  /** Null + `metricsLoading` = khung chờ; null không chờ (lỗi tải) = không vẽ dải số. */
  metrics: CtvShareMetric[] | null;
  metricsLoading?: boolean;
}) {
  const { openSnackbar } = useSnackbar();
  const shareWithFallback = useShareWithFallback();
  const lock = useActionLock();
  const path = ctvReferralPath(code);
  const url = path ? miniAppLink(path) : null;

  const share = () => {
    if (!path || !url) return;
    void lock.run('share', async () => {
      haptic('light');
      await shareWithFallback({ title, description: shareDescription(caption, offer), path }, url);
    });
  };
  const copy = () => {
    if (!url) return;
    void lock.run('copy', async () => {
      haptic('light');
      const ok = await copyText(url);
      openSnackbar(ok ? { text: CTV_SHARE_CARD_COPY.copied, type: 'success' } : { text: CTV_SHARE_CARD_COPY.copyFail, type: 'error' });
    });
  };

  return (
    <div data-testid="ctv-share-card">
      <div style={{ padding: 'var(--space-inset-card)', background: 'var(--color-action-secondary-bg)', borderRadius: 'var(--radius-control)' }}>
        <Text variant="price-lg" tone="brand" as="div" numeric data-testid="ctv-share-code" style={{ letterSpacing: 1, overflowWrap: 'anywhere' }}>
          {code}
        </Text>
        <Text variant="caption" tone="secondary" as="div" data-testid="ctv-share-offer" style={{ marginTop: 'var(--space-stack-xs)' }}>
          {ctvShareOfferLine(offer)}
        </Text>
      </div>

      {(metrics || metricsLoading) && (
        <>
          {metrics ? (
            <div role="group" aria-label={CTV_SHARE_CARD_COPY.metricsLabel} data-testid="ctv-metric-strip" style={STRIP}>
              {metrics.map((m) => (
                <div key={m.key} data-testid={`ctv-metric-${m.key}`} style={{ minWidth: 0, minHeight: TILE_MIN_HEIGHT }}>
                  <Text variant="body-md" as="div" numeric style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                    {m.value}
                  </Text>
                  <Text variant="caption" tone="tertiary" as="div">
                    {m.label}
                  </Text>
                </div>
              ))}
            </div>
          ) : (
            <div role="status" aria-label="Đang tải số liệu" style={STRIP}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={TILE_MIN_HEIGHT} />
              ))}
            </div>
          )}
          <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 'var(--space-stack-xs)' }}>
            {CTV_SHARE_CARD_COPY.metricsScope}
          </Text>
        </>
      )}

      {url && (
        // Xếp dọc như ShareSheet: hai nút cạnh nhau ở 320–375px bị cắt chữ ("Chia…", "Sao …").
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-sm)', marginTop: 'var(--space-inset-card)' }}>
          <Button fullWidth icon={Share2} loading={lock.active === 'share'} aria-disabled={lock.busy || undefined} onPress={share}>
            {CTV_SHARE_CARD_COPY.shareZalo}
          </Button>
          <Button fullWidth variant="secondary" icon={Copy} aria-disabled={lock.busy || undefined} onPress={copy}>
            {CTV_SHARE_CARD_COPY.copyLink}
          </Button>
        </div>
      )}
    </div>
  );
}
