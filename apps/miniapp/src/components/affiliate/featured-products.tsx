import { useEffect, useId, useRef, useState } from 'react';
import { Check, Link2 } from 'lucide-react';
import type { FeaturedAffiliateProduct } from '@tubutree/app-core/commerce/affiliate-share';
import { vnd } from '@tubutree/app-core/commerce/money';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { copyText } from '../../utils/clipboard';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { Heading, Text } from '../ui/text';

export interface AffiliateFeaturedProductsProps {
  /** Danh sách đã xếp sẵn (`featuredAffiliateProducts`); null khi đang tải. */
  products: readonly FeaturedAffiliateProduct[] | null;
  /** Tải danh sách lỗi: hiện lời báo và nút "Thử lại". */
  error?: boolean;
  onRetry?: () => void;
}

/** "Đã chép link" ở lại 2 giây rồi trả nhãn cũ; chép lỗi thì báo cách chép tay lâu hơn. */
const COPIED_MS = 2000;
const FAILED_MS = 4000;

/**
 * Khối "Sản phẩm hoa hồng nổi bật" của CTV: mỗi sản phẩm kèm mức hoa hồng, số tiền dự kiến trên một đơn và nút "Chép link giới thiệu" chép lời giới thiệu
 * có link gắn mã CTV (`?ref=`). Số đo ở lớp `.ctv-featured*` (css/tokens.css). Dữ liệu và link dựng ở `commerce/affiliate-share.ts`.
 */
export function AffiliateFeaturedProducts({ products, error, onRetry }: AffiliateFeaturedProductsProps) {
  const headingId = useId();
  const [done, setDone] = useState<{ id: string; ok: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onCopy = async (p: FeaturedAffiliateProduct) => {
    const ok = await copyText(p.share.text);
    clearTimeout(timer.current);
    setDone({ id: p.id, ok });
    timer.current = setTimeout(() => setDone(null), ok ? COPIED_MS : FAILED_MS);
  };

  return (
    <section data-testid="ctv-featured" aria-labelledby={headingId} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-sm)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-xs)' }}>
        <Text variant="caption" tone="brand" as="span">
          {fillCopy('ctv.featured.eyebrow')}
        </Text>
        <Heading variant="title-sm" as="h2" font="ui" id={headingId}>
          {fillCopy('ctv.featured.title')}
        </Heading>
      </div>
      {error ? (
        <div role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-stack-xs)' }}>
          <Text variant="body-sm" tone="danger">
            {fillCopy('ctv.featured.error')}
          </Text>
          {onRetry && (
            <Button variant="secondary" onPress={onRetry}>
              {fillCopy('ctv.featured.retry')}
            </Button>
          )}
        </div>
      ) : products === null ? (
        <div role="status" aria-label={fillCopy('ctv.featured.title')} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-sm)' }}>
          <Skeleton height={72} />
          <Skeleton height={72} />
          <Skeleton height={72} />
        </div>
      ) : products.length === 0 ? (
        <Text variant="body-sm" tone="secondary">
          {fillCopy('ctv.featured.empty')}
        </Text>
      ) : (
        <ul className="ctv-featured">
          {products.map((p) => {
            const copied = done?.id === p.id && done.ok;
            const failed = done?.id === p.id && !done.ok;
            return (
              <li key={p.id} className="ctv-featured__row" data-testid="ctv-featured-row">
                <div className="ctv-featured__info">
                  <Text variant="body-sm" as="span" className="ctv-featured__name">
                    {p.name}
                  </Text>
                  <div className="ctv-featured__meta">
                    <Badge tone="success" size="sm">
                      {fillCopy('ctv.featured.rate', { pct: p.ratePct })}
                    </Badge>
                    <Text variant="caption" tone="secondary" as="span" numeric>
                      {fillCopy('ctv.featured.perOrder', { amount: vnd(p.commission) })}
                    </Text>
                  </div>
                  {failed && (
                    <span role="status">
                      <Text variant="caption" tone="danger" as="span">
                        {fillCopy('ctv.featured.copyFail')}
                      </Text>
                    </span>
                  )}
                </div>
                <div className="ctv-featured__action">
                  <Button
                    variant="secondary"
                    icon={copied ? Check : Link2}
                    aria-label={copied ? fillCopy('ctv.featured.copied') : fillCopy('ctv.featured.copyAria', { name: p.name })}
                    onPress={() => onCopy(p)}
                  >
                    {fillCopy(copied ? 'ctv.featured.copied' : 'ctv.featured.copy')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
