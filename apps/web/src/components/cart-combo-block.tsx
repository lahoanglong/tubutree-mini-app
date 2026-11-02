'use client';

// Nguồn: apps/miniapp/src/components/cart-combo-block.tsx (điện thoại là mặc định; từ md bỏ nền khối, các dòng ngăn bằng đường kẻ như dòng lẻ trong thẻ giỏ)
import type { ReactNode } from 'react';
import { comboHeadingText, type ComboBlock } from '@tubutree/app-core/commerce/cart-combo';
import { Heading, Text } from '@/components/mini';

export interface CartComboBlockProps {
  block: Pick<ComboBlock<{ id: string }>, 'title' | 'saving' | 'hint'>;
  /** Cấp tiêu đề tiếp ngay sau tiêu đề trước đó của trang: h3 khi giỏ có tiêu đề nơi giao (h2), nếu không thì h2. */
  headingAs?: 'h2' | 'h3';
  /** Các dòng của bộ. */
  children: ReactNode;
}

/**
 * Khối combo ở giỏ: đầu nhóm "Combo: {tên} · Tiết kiệm {số}" rồi các dòng của bộ. Điện thoại: khối nền dịu bo đồng tâm (bo ngoài = bo dòng + đệm), khe
 * giữa dòng 8px, cùng số đo với Mini App. Từ md: không nền khối, đầu nhóm là dải nền dịu trên đầu các dòng.
 */
export function CartComboBlock({ block, headingAs = 'h3', children }: CartComboBlockProps) {
  return (
    <section
      aria-label={comboHeadingText(block)}
      data-testid="cart-combo-group"
      className="rounded-[calc(var(--radius-card)+var(--space-inline-sm))] bg-[var(--color-bg-subtle)] p-2 md:rounded-none md:bg-transparent md:p-0"
    >
      <div className="flex flex-col gap-2 md:gap-0 md:divide-y md:divide-stone-200">
        <div className="bg-[var(--color-bg-subtle)] px-1 md:px-3 md:py-2">
          <Heading
            variant="title-sm"
            as={headingAs}
            font="ui"
            data-testid="cart-combo-heading"
            className="[overflow-wrap:anywhere] [text-wrap:balance]"
          >
            {block.title}
            {block.saving && (
              <>
                {' · '}
                <span className="text-[color:var(--color-text-price-deal)]">{block.saving}</span>
              </>
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
    </section>
  );
}
