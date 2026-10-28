import { Battery, Layers, Milk, Package, Container } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { wasteItemIconKey, type WasteItemIconKey } from '@tubutree/app-core/waste-copy';
import { ProductThumb } from './ui/product-thumb';

const ICONS: Record<WasteItemIconKey, LucideIcon> = { package: Package, layers: Layers, milk: Milk, bottle: Container, battery: Battery };

/** Ảnh món Đổi rác; chưa có ảnh thì dùng biểu tượng theo loại món, mã lạ thì lá xanh mặc định. */
export function WasteItemThumb({ item, size = 48 }: { item: { code: string; imageUrl: string | null }; size?: number }) {
  const key = item.imageUrl ? null : wasteItemIconKey(item.code);
  if (!key) return <ProductThumb src={item.imageUrl} alt="" size={size} />;
  const Cmp = ICONS[key];
  return (
    <div
      data-item-icon={key}
      style={{
        width: size,
        height: size,
        flex: '0 0 auto',
        borderRadius: 'var(--radius-media)',
        background: 'var(--stone-100)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-brand-fg, var(--forest-600))',
      }}
    >
      <Cmp size={Math.round(size * 0.5)} strokeWidth={1.8} aria-hidden />
    </div>
  );
}
