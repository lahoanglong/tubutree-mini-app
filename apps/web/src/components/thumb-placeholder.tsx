import { brandAccent } from '@/components/mini/brand-accent';

/** Ô ảnh thay thế khi sản phẩm chưa có ảnh: hình lá và tên nhãn trên nền màu nhãn. Dùng chung cho thẻ sản phẩm, thẻ giờ vàng, thẻ mua lại. */
export function ThumbPlaceholder({ brand, iconSize = 36 }: { brand?: string | null; iconSize?: number }) {
  return (
    <div data-testid="card-placeholder" aria-hidden="true" className="relative flex h-full w-full flex-col items-center justify-center gap-1.5 overflow-hidden">
      <div className="absolute inset-0 opacity-[0.12]" style={{ background: brandAccent(brand ?? '') }} />
      <svg className="relative" width={iconSize} height={iconSize} viewBox="0 0 48 48" fill="none">
        <path d="M14 36c-1.5-14 8-26 24-27 1 16-7 27-20 28-2 .2-3.4-.4-4-1z" fill="var(--forest-300)" />
        <path d="M12 38c5-9 11-15 20-20" stroke="var(--forest-600)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {brand && <span className="relative max-w-[80%] truncate text-xs font-bold text-forest-700">{brand}</span>}
    </div>
  );
}
