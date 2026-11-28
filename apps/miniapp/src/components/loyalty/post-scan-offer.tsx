import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { postScanCopy, postScanView } from '@tubutree/app-core/refill/post-scan-offer';
import { refillLandingQuery } from '@tubutree/app-core/refill/refill-landing';
import { useNotify } from '../../hooks/use-notify';
import { usePublicConfig } from '../../hooks/use-public-config';
import { vi } from '../../i18n/vi';
import { getErrorMessage, isStaleStateError } from '../../services/api';
import { cartKey } from '../../services/cart-key';
import { coreHttp } from '../../services/core-http';
import { addToCart } from '../../services/shop-api';
import { playCartFeedback } from '../../utils/cart-feedback';
import { formatVnd } from '../../utils/format';
import { haptic } from '../../utils/haptic';
import { settleWithin } from '../../utils/settle-within';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { Text } from '../ui/text';

const ONE_LINE = { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;
// Id phân loại là cuid của máy chủ; vẫn bỏ dấu nháy và gạch chéo để chuỗi không phá bộ chọn thuộc tính.
const addButtonOf = (variationId: string) => document.querySelector(`[data-post-scan-add="${variationId.replace(/["\\]/g, '')}"]`);

export interface PostScanOfferProps {
  /** Điểm của đơn vừa quét (chờ cộng); null khi chưa tính được (REVIEW thiếu tiền hàng). */
  points: number | null;
}

/**
 * Thẻ gợi ý sau khi gửi mã đơn sàn thành công (w55-01), chunk lười ở `/points/scan`: tối đa ba dòng, một dòng giá trị điểm ("≈ 398đ giảm cho lần mua sau", 1 Điểm Xanh = 1đ
 * theo `loyalty.vnd_per_point_redeem`) và tối đa hai gói Refill của trang Tiết kiệm với Refill, mỗi gói một nút "Thêm" một chạm (số lượng 1, không nguồn riêng: không mượn
 * `repurchase_due` để khỏi lẫn số đo). Đơn sàn không có dòng sản phẩm nên không ghép theo món đã mua. Không có gì để nói (không điểm, không gói) thì không vẽ.
 * Nút chính và liên kết "Quét đơn khác" nằm ở trang, không ở thẻ. Cùng vai và số đo với `PostScanOffer` của web.
 */
export default function PostScanOffer({ points }: PostScanOfferProps) {
  const qc = useQueryClient();
  const { notify } = useNotify();
  const cfg = usePublicConfig();
  const landingQuery = refillLandingQuery(coreHttp);
  const q = useQuery(landingQuery);
  const view = postScanView({ points, vndPerPointRedeem: cfg.loyalty?.vndPerPointRedeem, landing: q.data }, formatVnd);
  const [added, setAdded] = useState<ReadonlySet<string>>(() => new Set());
  const inflight = useRef(false);

  const mutation = useMutation({
    mutationFn: ({ variationId }: { variationId: string; origin: Element | null }) => addToCart(variationId, 1),
    onSuccess: (cart, { variationId, origin }) => {
      qc.setQueryData(cartKey(), cart);
      setAdded((s) => new Set(s).add(variationId));
      haptic('medium');
      playCartFeedback(origin?.isConnected ? origin : null);
      notify({ text: vi.product.added, type: 'success', duration: 2000, position: 'top' });
    },
    onError: (e) => {
      notify({ text: getErrorMessage(e), type: 'error' });
      // Gói vừa hết hàng hay đổi giá: giữ khoá tới khi trang Refill về bản mới, kẻo chạm lại nhận đúng lời đó.
      return isStaleStateError(e) ? settleWithin(qc.invalidateQueries({ queryKey: landingQuery.queryKey })) : undefined;
    },
    onSettled: () => {
      inflight.current = false;
    },
  });
  const busy = mutation.isPending ? (mutation.variables?.variationId ?? null) : null;

  const loadingOffers = q.isLoading && view.offers.length === 0;
  if (!view.valueText && view.offers.length === 0 && !loadingOffers) return null;

  const add = (variationId: string) => {
    if (inflight.current) return;
    inflight.current = true;
    haptic('light');
    mutation.mutate({ variationId, origin: addButtonOf(variationId) });
  };

  return (
    <section aria-label={postScanCopy('region')} data-testid="post-scan-offer" style={{ marginTop: 'var(--space-inline-md)' }}>
      <Card variant="outline" padding={12}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-xs)' }}>
          {view.valueText && (
            <Text variant="label" tone="brand" as="p" numeric data-testid="post-scan-value">
              {view.valueText}
            </Text>
          )}
          {loadingOffers && (
            <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-xs)' }}>
              <Skeleton height={44} />
              <Skeleton height={44} />
            </div>
          )}
          {view.offers.map((o) => {
            const done = added.has(o.variationId);
            return (
              <div key={o.variationId} data-testid="post-scan-offer-row" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-inline-md)' }}>
                <Text variant="body-sm" as="span" style={ONE_LINE}>
                  {o.name}
                </Text>
                <Text variant="caption" tone="secondary" as="span" numeric style={{ flex: '0 0 auto' }}>
                  {o.priceLabel}
                </Text>
                <span data-post-scan-add={o.variationId} style={{ display: 'inline-flex', flex: '0 0 auto' }}>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy === o.variationId}
                    disabled={done || (busy !== null && busy !== o.variationId)}
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
    </section>
  );
}
