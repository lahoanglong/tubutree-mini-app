'use client';

// Nguồn: apps/miniapp/src/components/orders/order-status-hero.tsx
import { shortDateTime, type OrderHeadline } from '@tubutree/app-core/commerce/order-tracking';
import { Heading, Text } from '@/components/mini/text';

export interface OrderStatusHeroProps {
  headline: OrderHeadline;
  /** Nhãn trạng thái cho khách (đơn đã đặt hãng thì "Đã đặt đơn vị vận chuyển"). */
  statusLabel: string;
  /** Mốc "Đặt lúc" / "Giao lúc" / "Huỷ lúc". */
  stamp: { label: string; at: string };
  /** Cặp màu của trạng thái; chữ kế thừa `fg` (không dùng độ mờ, vì nó kéo cặp màu dưới 4,5:1). */
  tone: { bg: string; fg: string };
}

/** Đầu trang theo dõi đơn: trạng thái, một câu nói đơn đang ở đâu, lý do huỷ (đơn đã huỷ), mốc cần biết (ngày giao, hạn trả, hạn đổi/trả) và bước kế tiếp. */
export function OrderStatusHero({ headline, statusLabel, stamp, tone }: OrderStatusHeroProps) {
  const inherit = { color: 'inherit' } as const;
  // Lý do huỷ có thể là chữ khách gõ (link, số tài khoản) không có dấu cách: không ngắt thì web cắt mất cuối dòng, Mini cuộn ngang cả trang.
  const wrap = { ...inherit, overflowWrap: 'anywhere' } as const;
  return (
    <section
      data-testid="status-hero"
      aria-label="Tình trạng đơn hàng"
      style={{ background: tone.bg, color: tone.fg, padding: 'var(--space-inset-page)', display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-xs)' }}
    >
      <Text variant="caption" as="p" style={inherit}>
        {stamp.label} <span>{shortDateTime(stamp.at)}</span>
      </Text>
      <Heading variant="title-sm" as="h2" font="ui" style={inherit}>
        {statusLabel}
      </Heading>
      {headline.sentence && (
        <Text variant="body-md" as="p" style={wrap}>
          {headline.sentence}
        </Text>
      )}
      {headline.reason && (
        <Text variant="body-sm" as="p" data-testid="order-cancel-reason" style={{ ...wrap, fontWeight: 600 }}>
          {headline.reason}
        </Text>
      )}
      {headline.milestone && (
        <Text variant="body-sm" as="p" data-testid="order-milestone" style={{ ...wrap, fontWeight: 600 }}>
          {headline.milestone}
        </Text>
      )}
      {headline.next && (
        <Text variant="caption" as="p" data-testid="order-next" style={wrap}>
          {headline.next}
        </Text>
      )}
    </section>
  );
}
