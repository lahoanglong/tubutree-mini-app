'use client';

// Nguồn: apps/miniapp/src/components/cart-combo-block.tsx (điện thoại là mặc định; từ md bỏ nền khối, các dòng ngăn bằng đường kẻ như dòng lẻ trong thẻ giỏ, vạch dọc bên trái ghi chỗ bộ bắt đầu và kết thúc; vạch là phần tử giả vẽ đè lên lề trái, không chiếm chỗ, để cột ô chọn thẳng hàng với dòng lẻ)
import type { ReactNode } from 'react';
import { comboHeadingText, type ComboBlock } from '@tubutree/app-core/commerce/cart-combo';
import { Heading, Text } from '@/components/mini';

export interface CartComboBlockProps {
  block: Pick<ComboBlock<{ id: string }>, 'title' | 'saving' | 'savingPending' | 'hint'>;
  /** Cấp tiêu đề tiếp ngay sau tiêu đề trước đó của trang: h3 khi giỏ có tiêu đề nơi giao (h2), nếu không thì h2. */
  headingAs?: 'h2' | 'h3';
  /** Các dòng của bộ. */
  children: ReactNode;
}

/**
 * Khối combo ở giỏ: đầu nhóm "Combo: {tên} · Tiết kiệm {số}" rồi các dòng của bộ. Điện thoại: khối nền dịu bo đồng tâm (bo ngoài = bo dòng + đệm), khe
 * giữa dòng 8px, cùng số đo với Mini App. Từ md: không nền khối, đầu nhóm là dải nền dịu trên đầu các dòng; các dòng trong thẻ giỏ ngăn nhau bằng cùng một đường
 * kẻ nên bộ cần vạch dọc bên trái chạy hết chiều cao khối để khách thấy bộ kết thúc ở đâu.
 */
export function CartComboBlock({ block, headingAs = 'h3', children }: CartComboBlockProps) {
  return (
    <section
      aria-label={comboHeadingText(block)}
      data-testid="cart-combo-group"
      className="rounded-[calc(var(--radius-card)+var(--space-inline-sm))] bg-[var(--color-bg-subtle)] p-2 md:relative md:isolate md:rounded-none md:bg-transparent md:p-0 md:before:pointer-events-none md:before:absolute md:before:inset-y-0 md:before:left-0 md:before:z-[1] md:before:w-1 md:before:bg-[color:var(--color-border-strong)]"
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
              <span data-testid="cart-combo-saving" aria-hidden={block.savingPending || undefined} className={block.savingPending ? 'invisible' : undefined}>
                {' · '}
                <span className="text-[color:var(--color-text-price-deal)]">{block.saving}</span>
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
    </section>
  );
}
