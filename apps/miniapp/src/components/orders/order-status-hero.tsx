import { orderHeroLine, shortDateTime, type OrderHeadline, type OrderHeroLineKind } from '@tubutree/app-core/commerce/order-tracking';
import { Heading, Text } from '../ui/text';

export interface OrderStatusHeroProps {
  headline: OrderHeadline;
  /** Nhãn trạng thái cho khách (đơn đã đặt hãng thì "Đã đặt đơn vị vận chuyển"). */
  statusLabel: string;
  /** Mốc "Đặt lúc" / "Giao lúc" / "Huỷ lúc". */
  stamp: { label: string; at: string };
  /** Cặp màu của trạng thái; chữ kế thừa `fg` (không dùng độ mờ, vì nó kéo cặp màu dưới 4,5:1). */
  tone: { bg: string; fg: string };
}

const HERO_LINE_TESTID: Record<OrderHeroLineKind, string> = { reason: 'order-cancel-reason', milestone: 'order-milestone', next: 'order-next', sentence: 'order-hero-sentence' };

/**
 * Đầu trang theo dõi đơn, tối đa ba phần tử quét một lượt (W47): mốc ngày ("Đặt lúc", "Giao lúc"...), trạng thái, và MỘT câu khách cần biết tiếp theo
 * (`orderHeroLine`: lý do huỷ, hạn thanh toán, ngày giao dự kiến, hạn đổi/trả, hay bước kế của đơn đã xong).
 */
export function OrderStatusHero({ headline, statusLabel, stamp, tone }: OrderStatusHeroProps) {
  const inherit = { color: 'inherit' } as const;
  const line = orderHeroLine(headline);
  return (
    <section
      data-testid="status-hero"
      aria-label="Tình trạng đơn hàng"
      style={{ background: tone.bg, color: tone.fg, padding: 'var(--space-inset-page)', display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-xs)' }}
    >
      <Text variant="caption" as="p" numeric style={inherit}>
        {stamp.label} <span>{shortDateTime(stamp.at)}</span>
      </Text>
      <Heading variant="title-sm" as="h2" font="ui" style={inherit}>
        {statusLabel}
      </Heading>
      {line && (
        // Lý do huỷ có thể là chữ khách gõ (link, số tài khoản) không có dấu cách: không ngắt thì web cắt mất cuối dòng, Mini cuộn ngang cả trang.
        <Text variant="body-sm" as="p" numeric data-testid={HERO_LINE_TESTID[line.kind]} style={{ ...inherit, overflowWrap: 'anywhere', fontWeight: 600 }}>
          {line.text}
        </Text>
      )}
    </section>
  );
}
