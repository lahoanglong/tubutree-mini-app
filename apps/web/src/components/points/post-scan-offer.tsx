'use client';

// Nguồn: apps/miniapp/src/components/loyalty/post-scan-offer.tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { postScanCopy, postScanView } from '@tubutree/app-core/refill/post-scan-offer';
import { refillLandingQuery } from '@tubutree/app-core/refill/refill-landing';
import { useQuickAdd } from '@/app/tai-khoan/yeu-thich/quick-add';
import { Button, Card, Skeleton, Text } from '@/components/mini';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { usePublicConfig } from '@/lib/use-public-config';

const ONE_LINE = { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;
// Id phân loại là cuid của máy chủ; vẫn bỏ dấu nháy và gạch chéo để chuỗi không phá bộ chọn thuộc tính.
const addButtonOf = (variationId: string) => document.querySelector(`[data-post-scan-add="${variationId.replace(/["\\]/g, '')}"]`);

export interface PostScanOfferProps {
  /** Điểm của đơn vừa quét (chờ cộng); null khi chưa tính được (REVIEW thiếu tiền hàng). */
  points: number | null;
}

/**
 * Thẻ gợi ý sau khi gửi mã đơn sàn thành công (w55-01), tải lười ở `/quet-ma`: tối đa ba dòng, một dòng giá trị điểm ("≈ 398đ giảm cho lần mua sau", 1 Điểm Xanh = 1đ
 * theo `loyalty.vnd_per_point_redeem`) và tối đa hai gói Refill của trang Tiết kiệm với Refill, mỗi gói một nút "Thêm" một chạm (số lượng 1, không nguồn riêng) qua đường
 * giỏ nhanh dùng chung. Đơn sàn không có dòng sản phẩm nên không ghép theo món đã mua. Không có gì để nói (không điểm, không gói) thì không vẽ.
 * Nút chính và liên kết "Quét đơn khác" nằm ở trang, không ở thẻ. Cùng vai và số đo với `PostScanOffer` của Mini App.
 */
export default function PostScanOffer({ points }: PostScanOfferProps) {
  const cfg = usePublicConfig();
  const landingQuery = refillLandingQuery(coreHttp);
  const q = useQuery(landingQuery);
  const quick = useQuickAdd(undefined, landingQuery.queryKey);
  const view = postScanView({ points, vndPerPointRedeem: cfg.loyalty?.vndPerPointRedeem, landing: q.data }, formatVnd);
  const [added, setAdded] = useState<ReadonlySet<string>>(() => new Set());

  const loadingOffers = q.isLoading && view.offers.length === 0;
  if (!view.valueText && view.offers.length === 0 && !loadingOffers) return null;

  const add = (variationId: string) => {
    if (quick.busyId !== null) return;
    void quick.addVariation(variationId, { origin: addButtonOf(variationId) }).then((ok) => {
      if (ok) setAdded((s) => (s.has(variationId) ? s : new Set(s).add(variationId)));
    });
  };

  return (
    <section aria-label={postScanCopy('region')} data-testid="post-scan-offer" style={{ marginTop: 'var(--space-inline-md)' }}>
      <Card variant="outline" padding={12}>
        <div className="flex flex-col" style={{ gap: 'var(--space-stack-xs)' }}>
          {view.valueText && (
            <Text variant="label" tone="brand" as="p" numeric data-testid="post-scan-value">
              {view.valueText}
            </Text>
          )}
          {loadingOffers && (
            <div aria-hidden="true" className="flex flex-col" style={{ gap: 'var(--space-stack-xs)' }}>
              <Skeleton height={44} />
              <Skeleton height={44} />
            </div>
          )}
          {view.offers.map((o) => {
            const done = added.has(o.variationId);
            return (
              <div key={o.variationId} data-testid="post-scan-offer-row" className="flex items-center" style={{ gap: 'var(--space-inline-md)' }}>
                <Text variant="body-sm" as="span" style={ONE_LINE}>
                  {o.name}
                </Text>
                <Text variant="caption" tone="secondary" as="span" numeric style={{ flex: '0 0 auto' }}>
                  {o.priceLabel}
                </Text>
                <span data-post-scan-add={o.variationId} className="inline-flex flex-none">
                  <Button
                    variant="secondary"
                    size="md"
                    loading={quick.busyId === o.variationId}
                    disabled={done || (quick.busyId !== null && quick.busyId !== o.variationId)}
                    {...(done ? null : { 'aria-label': o.addAria })}
                    onPress={() => add(o.variationId)}
                  >
                    {done ? postScanCopy('added') : postScanCopy('add')}
                  </Button>
                </span>
              </div>
            );
          })}
        </div>
      </Card>
      {quick.feedback}
    </section>
  );
}
