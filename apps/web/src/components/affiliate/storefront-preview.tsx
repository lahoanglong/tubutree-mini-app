import { Sprout } from 'lucide-react';
import type { StorefrontEdit } from '@tubutree/app-core/api/storefront';
import { formatVnd } from '@/lib/format-vnd';
import { cssUrl } from '@/lib/safe-color';

const MAX_TILES = 4;

/** Bản xem trước cho chính chủ khi khách chưa xem được (nháp, chờ duyệt): cùng bố cục rút gọn với trang công khai /s/[slug]. */
export function StorefrontPreview({ sf }: { sf: StorefrontEdit }) {
  const items = sf.collections.flatMap((c) => c.items).filter((it) => !it.isHidden && !it.hiddenReason);
  const shown = items.slice(0, MAX_TILES);

  return (
    <div data-testid="storefront-preview" className="overflow-hidden rounded-card border border-stone-200 bg-stone-50">
      <div
        className="h-[72px] bg-forest-700 bg-cover bg-center"
        style={sf.coverUrl ? { backgroundImage: cssUrl(sf.coverUrl) } : undefined}
      />
      <div className="-mt-6 px-3 pb-3">
        <div
          className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-[3px] border-stone-0 bg-forest-600 bg-cover bg-center"
          style={sf.avatarUrl ? { backgroundImage: cssUrl(sf.avatarUrl) } : undefined}
        >
          {!sf.avatarUrl && <Sprout className="h-6 w-6 text-stone-0" aria-hidden="true" />}
        </div>
        <h3 className="mt-1.5 font-display text-base font-semibold text-stone-900">{sf.title}</h3>
        <div className="text-xs text-stone-600">/s/{sf.slug}</div>
        {sf.headerNote && <p className="mt-1.5 text-sm text-stone-700">{sf.headerNote}</p>}
        {shown.length === 0 ? (
          <p className="mt-2.5 text-xs text-stone-600">Chưa có sản phẩm nào.</p>
        ) : (
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            {shown.map((it) => (
              <div key={it.id} className="rounded-control border border-stone-200 bg-stone-0 p-2">
                <div className="line-clamp-2 text-sm text-stone-900">{it.product?.name ?? 'Sản phẩm'}</div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums text-stone-900">
                  {formatVnd(it.product?.salePrice ?? it.product?.basePrice ?? 0)}
                </div>
              </div>
            ))}
          </div>
        )}
        {items.length > shown.length && <p className="mt-2 text-xs text-stone-600">và {items.length - shown.length} sản phẩm khác</p>}
      </div>
    </div>
  );
}
