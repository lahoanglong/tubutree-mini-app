import { Sprout } from 'lucide-react';
import type { StorefrontEdit } from '@tubutree/app-core/api/storefront';
import { planShopSections } from '@tubutree/app-core/commerce/shop-page';
import { visibleCollection } from '@tubutree/app-core/commerce/storefront-builder';
import { ShopSection } from '@/components/mini/shop-section';
import { cssUrl } from '@/lib/safe-color';

/**
 * Bản xem trước cho chính chủ khi khách chưa xem được (nháp, chờ duyệt): dựng bằng chính `ShopSection` của tab Shop của trang công khai
 * /s/[slug], với đúng phần khách thấy (món ẩn bị bỏ) và đúng trần số khối. Cả khung là `inert`: Tab/Enter không vào link, chủ không rời màn giữa chừng.
 */
export function StorefrontPreview({ sf }: { sf: StorefrontEdit }) {
  const sections = planShopSections(sf.collections.map(visibleCollection)).main;

  return (
    <div data-testid="storefront-preview" inert className="overflow-hidden rounded-card border border-stone-200 bg-stone-50">
      <div
        className="h-[72px] bg-forest-700 bg-cover bg-center"
        style={sf.coverUrl ? { backgroundImage: cssUrl(sf.coverUrl) } : undefined}
      />
      <div className="-mt-6 px-4 pb-3">
        <div
          className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-[3px] border-stone-0 bg-forest-600 bg-cover bg-center"
          style={sf.avatarUrl ? { backgroundImage: cssUrl(sf.avatarUrl) } : undefined}
        >
          {!sf.avatarUrl && <Sprout className="h-6 w-6 text-stone-0" aria-hidden="true" />}
        </div>
        <h3 className="mt-1.5 font-display text-base font-semibold text-stone-900">{sf.title}</h3>
        <div className="text-xs text-stone-600">/s/{sf.slug}</div>
        {sf.headerNote && <p className="mt-1.5 text-sm text-stone-700">{sf.headerNote}</p>}
        {sections.length === 0 ? (
          <p className="mt-2.5 text-xs text-stone-600">Chưa có sản phẩm nào.</p>
        ) : (
          <div className="mt-2.5">
            {sections.map((c) => (
              <ShopSection key={c.id} collection={c} preview />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
