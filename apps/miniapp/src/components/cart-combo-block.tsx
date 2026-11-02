import type { ReactNode } from 'react';
import { comboHeadingText, type ComboBlock } from '@tubutree/app-core/commerce/cart-combo';
import { Card } from './ui/card';
import { Heading, Text } from './ui/text';

export interface CartComboBlockProps {
  block: Pick<ComboBlock<{ id: string }>, 'title' | 'saving' | 'savingPending' | 'hint'>;
  /** Cấp tiêu đề tiếp ngay sau tiêu đề trước đó của trang: h3 khi giỏ có tiêu đề nơi giao (h2), nếu không thì h2. */
  headingAs?: 'h2' | 'h3';
  /** Các dòng của bộ (CartLineRow). */
  children: ReactNode;
}

/**
 * Khối combo ở giỏ: đầu nhóm "Combo: {tên} · Tiết kiệm {số}" rồi các dòng của bộ trên nền dịu, để khách thấy món nào cùng bộ và bộ đang giảm bao nhiêu.
 * Chữ do `cartComboBlocks` dựng (shop-copy); khối chỉ vẽ. Bo ngoài = bo dòng + đệm (bo đồng tâm) để góc dòng không lệch với góc khối.
 */
export function CartComboBlock({ block, headingAs = 'h3', children }: CartComboBlockProps) {
  return (
    <section aria-label={comboHeadingText(block)} data-testid="cart-combo-group">
      <Card variant="flat" padding={8} style={{ borderRadius: 'calc(var(--radius-card) + var(--space-inline-sm))' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-sm)' }}>
          <div style={{ paddingInline: 'var(--space-stack-xs)' }}>
            <Heading
              variant="title-sm"
              as={headingAs}
              font="ui"
              data-testid="cart-combo-heading"
              style={{ overflowWrap: 'anywhere', textWrap: 'balance' }}
            >
              {block.title}
              {block.saving && (
                // Chờ máy chủ tính lại: giữ chỗ của số (ẩn, không đọc) để đầu nhóm không đổi số dòng và khối không nhảy mỗi lần bấm +/−.
                <span
                  data-testid="cart-combo-saving"
                  aria-hidden={block.savingPending || undefined}
                  style={block.savingPending ? { visibility: 'hidden' } : undefined}
                >
                  {' · '}
                  <span style={{ color: 'var(--color-text-price-deal)' }}>{block.saving}</span>
                </span>
              )}
            </Heading>
            {block.hint && (
              <Text variant="caption" tone="secondary" as="p" data-testid="cart-combo-hint">
                {block.hint}
              </Text>
            )}
          </div>
          {children}
        </div>
      </Card>
    </section>
  );
}
