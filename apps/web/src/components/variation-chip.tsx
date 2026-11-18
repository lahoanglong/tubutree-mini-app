'use client';

// Nguồn: apps/miniapp/src/components/product/variation-chip.tsx
import { Zap } from 'lucide-react';
import { fillTileCopy } from '@tubutree/app-core/commerce/tile-copy';
import { formatVnd } from '@/lib/shop-client';
import { phoneBodySm, phoneCaption } from '@/lib/phone-ui';
import { variationLabel } from '@/lib/variation-label';

export interface VariationChipProps {
  variation: { name: string; stock: number };
  /** Số phân loại của sản phẩm (kể cả phân loại này): tên trống thì "Mặc định" khi có anh em, không có anh em thì chip chỉ còn giá. Chip chỉ vẽ trong bộ chọn từ 2 phân loại nên mặc định là 2. */
  siblingCount?: number;
  /** Giá khách thật sự trả cho một đơn vị (đã áp Giờ vàng), từ `variationPricing`. */
  pricing: { price: number; isFlash: boolean; salePct?: number };
  active: boolean;
  onClick: () => void;
  /** Hết hàng mà vẫn chọn được: cờ báo hàng về bật, khách chọn đúng phân loại rồi bấm "Báo tôi khi có hàng". Mặc định khoá như trước. */
  outSelectable?: boolean;
  /** Giá theo đơn vị của phân loại này ("≈ 9.900đ / 100ml", `commerce/unit-price.ts`); không truyền thì chip giữ như cũ. */
  unit?: string | null;
  /** Nhãn "Lợi hơn 37% mỗi 100ml" nếu đây là phân loại được nhãn; nằm cùng dòng giá theo đơn vị để chip chỉ thêm một dòng. */
  better?: string | null;
}

/**
 * Chip phân loại, dùng chung ở trang sản phẩm (`AddToCart`) và bảng chọn phân loại để hai nơi ghi cùng giá, cùng dấu Giờ vàng và cùng chữ
 * hết hàng ("Tạm hết hàng", không chỉ gạch ngang). Điện thoại: hai dòng (tên cỡ chữ 14px với dòng 22px, giá cỡ chữ 13px với dòng 20px, như `Text variant="body-sm"` và `"caption"` của Mini App), đệm dọc và viền 1,5px; cùng cấu trúc đó
 * nên chip hai app cao bằng nhau. Không ghi chiều cao tuyệt đối: viền 1,5px làm tròn theo mật độ điểm ảnh của từng thiết bị (xem `apps/e2e/tests/support/variation-chip.ts`). Từ md giữ "tên · giá" một
 * dòng để nút mua còn trong 1280×800.
 */
export function VariationChip({ variation, siblingCount = 2, pricing, active, onClick, outSelectable = false, unit, better }: VariationChipProps) {
  const out = variation.stock <= 0;
  const locked = out && !outSelectable;
  const label = variationLabel(variation.name, siblingCount);
  // Giờ vàng đã có dấu riêng; ở đây chỉ phân loại đang giảm giá thường (giá gạch cao hơn giá bán) mới ghi phần trăm tiết kiệm.
  const savePct = !out && !pricing.isFlash && (pricing.salePct ?? 0) > 0 ? pricing.salePct! : 0;
  return (
    <button
      type="button"
      aria-pressed={active}
      // Hết hàng thì khoá hẳn như chip của Mini App: không chọn được (chọn xong nút mua chỉ đổi thành "Tạm hết hàng", khó hiểu) và control
      // đang khoá được miễn luật tương phản, nên chữ mờ "Tạm hết hàng" không bị tính là chữ nhạt đang tương tác.
      disabled={locked}
      onClick={locked ? undefined : onClick}
      className={`min-h-11 rounded-control border px-4 text-sm transition max-md:flex max-md:flex-col max-md:items-start max-md:border-[1.5px] max-md:px-3.5 max-md:py-2 max-md:text-left ${
        active
          ? 'border-[var(--color-border-selected)] bg-[var(--color-action-secondary-bg)] font-semibold text-[var(--color-text-brand)]'
          : 'border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)] max-md:border-[var(--color-border-subtle)]'
      } ${locked ? 'opacity-60 max-md:opacity-[0.55]' : ''}`}
    >
      {label && (
        <>
          <span className={`${active ? 'max-md:font-semibold' : 'max-md:font-normal'} ${locked ? 'line-through' : ''} ${phoneBodySm}`}>{label}</span>
          <span aria-hidden="true" className="max-md:hidden">
            {' · '}
          </span>
        </>
      )}
      <span
        className={`inline-flex items-center gap-0.5 tabular-nums ${phoneCaption} max-md:font-normal ${
          locked
            ? 'max-md:text-[var(--color-text-disabled)]'
            : pricing.isFlash && !out
              ? 'max-md:text-[var(--color-text-price-deal)]'
              : active && !out
                ? 'max-md:text-[var(--color-text-brand)]'
                : 'max-md:text-[var(--color-text-secondary)]'
        }`}
      >
        {out ? (
          fillTileCopy('stock.out')
        ) : (
          <>
            {pricing.isFlash && <Zap className="hidden h-3 w-3 max-md:block" strokeWidth={2} aria-hidden="true" />}
            {formatVnd(pricing.price)}
            {savePct > 0 && (
              <>
                <span aria-hidden="true" className="ml-0.5 font-semibold text-[var(--color-text-price-deal)]">
                  {fillTileCopy('badge.discount', { pct: savePct })}
                </span>
                <span className="sr-only">, {fillTileCopy('badge.discountSpoken', { pct: savePct })}</span>
              </>
            )}
          </>
        )}
      </span>
      {pricing.isFlash && !out && <span className="ml-1.5 text-xs font-bold text-promo-fg max-md:sr-only">Giờ vàng</span>}
      {!out && unit && (
        <span data-testid="variation-unit-price" className={`block text-xs font-normal tabular-nums text-[var(--color-text-secondary)] ${phoneCaption}`}>
          {unit}
          {better && <span className="font-semibold text-[var(--color-text-brand)]"> · {better}</span>}
        </span>
      )}
    </button>
  );
}
