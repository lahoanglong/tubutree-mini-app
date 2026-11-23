'use client';

import { useQuery } from '@tanstack/react-query';
import { FlaskConical, Package, PackageX, Recycle } from 'lucide-react';
import { ownedBrandCatalogHealthQuery } from '@tubutree/app-core/queries/brand-owner';
import { errorStatus } from '@tubutree/app-core/api/error-status';
import { coreHttp } from '@/lib/core-http';
import { ownerLoadError } from '@/lib/brand-owner-view';
import { skin } from '@/components/pro-shared/mini-skin';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Stat } from './sales-tab';

export const CATALOG_TAB_NOTE =
  'Chỉ tính sản phẩm đang bật của thương hiệu bạn quản lý. SKU là từng phân loại của sản phẩm, như dung tích hay mùi hương; tồn kho là số Tubu đồng bộ từ kho.';
const INCI_HINT = 'Gửi Tubu bảng thành phần, hoặc ảnh mặt sau bao bì có mục "Thành phần", để Tubu bổ sung lên trang sản phẩm.';
const STOCK_HINT = 'Nhập hàng về kho Tubu xong, số tồn tự cập nhật ở lần đồng bộ kế tiếp.';

function ListNote({ shown, total }: { shown: number; total: number }) {
  if (shown >= total) return null;
  return <p className="mt-1 text-xs text-stone-600">Đang hiện {shown}/{total} dòng đầu.</p>;
}

/** Tab "Sản phẩm & Chất lượng": chủ thương hiệu tự rà SKU hết hàng và sản phẩm thiếu thành phần (INCI). Chỉ đọc; máy chủ chỉ trả nhãn của chính tài khoản. */
export function CatalogTab() {
  const q = useQuery({ ...ownedBrandCatalogHealthQuery(coreHttp), staleTime: 30_000, retry: false });
  const d = q.data;

  return (
    <div className="flex flex-col gap-3 pb-6">
      {q.isLoading ? (
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Skeleton height={84} rounded="rounded-card" />
          <Skeleton height={84} rounded="rounded-card" />
        </div>
      ) : !d ? (
        <ErrorState variant="inline" message={ownerLoadError(q.error)} onRetry={errorStatus(q.error) === 403 ? undefined : () => q.refetch()} />
      ) : d.totalProducts === 0 ? (
        <section aria-label="Chưa có sản phẩm" className={`p-8 text-center ${skin.card}`}>
          <h2 className="font-display text-base font-semibold text-stone-900">Chưa có sản phẩm nào đang bán</h2>
          <p className="mt-1 text-sm text-stone-600">Sản phẩm của thương hiệu được Tubu bật bán sẽ hiện ở đây để bạn tự rà tồn kho và thành phần.</p>
        </section>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <Stat icon={Package} label="SKU đang bán" value={String(d.totalSkus)} />
            <Stat icon={PackageX} label="SKU hết hàng" value={String(d.outOfStockSkus)} />
            <Stat icon={Recycle} label="SKU có gói Refill" value={d.refillPairedSkus === null ? '—' : String(d.refillPairedSkus)} />
            <Stat icon={FlaskConical} label="Sản phẩm thiếu thành phần" value={String(d.missingInciProducts)} />
          </div>

          {d.missingInciProducts === 0 && d.outOfStockSkus === 0 && (
            <p role="status" className="rounded-control bg-success-bg px-3 py-2 text-sm text-success-fg">
              Mọi sản phẩm đã có thành phần và còn hàng.
            </p>
          )}

          {d.missingInciProducts > 0 && (
            <section aria-label="Sản phẩm thiếu thành phần" className={`${skin.plain} p-0 md:p-4`}>
              <h2 className="mb-1 mt-2 text-base font-display md:mt-0 md:font-ui font-semibold text-stone-900">Thiếu thành phần (INCI)</h2>
              <p className="text-xs text-stone-600">{INCI_HINT}</p>
              <ul className="mt-1">
                {d.missingInci.map((p) => (
                  <li key={p.productId} className="flex min-h-11 items-center gap-3 border-b border-stone-200 py-2 last:border-b-0">
                    <span className="min-w-0 flex-1 text-sm text-stone-900 [overflow-wrap:anywhere]">{p.name}</span>
                    <span className="flex-none text-xs tabular-nums text-stone-600">{p.skuCount} SKU</span>
                  </li>
                ))}
              </ul>
              <ListNote shown={d.missingInci.length} total={d.missingInciProducts} />
            </section>
          )}

          {d.outOfStockSkus > 0 && (
            <section aria-label="SKU hết hàng" className={`${skin.plain} p-0 md:p-4`}>
              <h2 className="mb-1 mt-2 text-base font-display md:mt-0 md:font-ui font-semibold text-stone-900">SKU hết hàng</h2>
              <p className="text-xs text-stone-600">{STOCK_HINT}</p>
              <ul className="mt-1">
                {d.outOfStock.map((v) => (
                  <li key={v.sku} className="flex min-h-11 flex-col justify-center border-b border-stone-200 py-2 last:border-b-0">
                    <span className="text-sm text-stone-900 [overflow-wrap:anywhere]">
                      {v.productName}
                      {v.name && v.name !== v.productName ? ` · ${v.name}` : ''}
                    </span>
                    <span className="font-mono text-xs text-stone-600 [overflow-wrap:anywhere]">{v.sku}</span>
                  </li>
                ))}
              </ul>
              <ListNote shown={d.outOfStock.length} total={d.outOfStockSkus} />
            </section>
          )}
        </>
      )}

      <p className="text-xs text-stone-600">{CATALOG_TAB_NOTE}</p>
    </div>
  );
}
