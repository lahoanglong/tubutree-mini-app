import { Battery, Layers, Milk, Package, Wine } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { wasteItemIconKey, type WasteItemIconKey } from '@tubutree/app-core/waste-copy';
import { ProductThumb } from '@/components/mini';

const ICONS: Record<WasteItemIconKey, LucideIcon> = { package: Package, layers: Layers, milk: Milk, bottle: Wine, battery: Battery };

/** Ảnh món Đổi rác; chưa có ảnh thì dùng biểu tượng theo loại món, mã lạ thì lá xanh mặc định (cùng Mini App). */
export function WasteItemThumb({ item, size = 48 }: { item: { code: string; imageUrl: string | null }; size?: number }) {
  const key = item.imageUrl ? null : wasteItemIconKey(item.code);
  if (!key) return <ProductThumb src={item.imageUrl} alt="" size={size} />;
  const Cmp = ICONS[key];
  return (
    <div
      data-item-icon={key}
      style={{ width: size, height: size }}
      className="flex flex-none items-center justify-center rounded-media bg-stone-100 text-forest-600"
    >
      <Cmp size={Math.round(size * 0.5)} strokeWidth={1.8} aria-hidden="true" />
    </div>
  );
}
