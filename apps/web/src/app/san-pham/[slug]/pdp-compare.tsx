'use client';

import Link from 'next/link';
import type { ProductCompare } from '@tubutree/app-core/api/product-compare';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { PriceTag } from '@/components/mini/price-tag';
import { compareRows } from './compare-view';
import { pdpBand, pdpSectionTitle } from './pdp-sections';

const MISSING = '—';

// Đệm ngang nhỏ: ở 360px mỗi cột món còn ~87px, đủ cho giá bảy chữ số không xuống dòng.
const cell = 'px-1.5 py-2 align-top';
const rowHead = `${cell} text-left text-xs font-semibold text-[var(--color-text-secondary)]`;

/**
 * "So với món tương tự" (cờ `catalog.pdp_compare_enabled`): món đang xem và tối đa 2 món cùng phân khúc, mỗi món một cột. Hàng Giá luôn có; Giá/100ml hay
 * Giá/100g chỉ khi món đang xem có giá theo đơn vị (máy chủ đã quy về cùng loại đơn vị); Dung tích, Thành phần chính khi có ít nhất một món có số liệu; ô thiếu
 * ghi "—". Hàng cuối là lối "Xem" sang từng món. Bảng chia cột cố định và chữ xuống dòng nên không tràn ngang ở 360px. Dữ liệu do máy chủ lấy khi dựng trang.
 */
export function PdpCompare({ data }: { data: ProductCompare | null | undefined }) {
  const rows = compareRows(data);
  if (!rows) return null;
  const items = [rows.current, ...rows.others];
  const per = rows.current.unitPrice?.per;
  const hasSize = items.some((it) => !!it.size);
  const hasIngredients = items.some((it) => (it.keyIngredients ?? []).length > 0);
  return (
    <section data-pdp-block="compare" data-section="pdp-compare" aria-labelledby="pdp-compare-title" className={pdpBand}>
      <h2 id="pdp-compare-title" className={pdpSectionTitle}>
        {fillCopy('pdp.compareTitle')}
      </h2>
      <table className="mt-3 w-full table-fixed border-collapse text-sm text-[var(--color-text-primary)] tabular-nums">
        <colgroup>
          <col className="w-1/5" />
          {items.map((it) => (
            <col key={it.productId} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-[var(--color-border-subtle)]">
            <td className={cell} />
            {items.map((it, i) => (
              <th key={it.productId} scope="col" className={`${cell} text-left text-xs font-semibold [overflow-wrap:anywhere]`}>
                {i === 0 ? (
                  <span className="text-[var(--color-text-brand)]">{fillCopy('pdp.compareThis')}</span>
                ) : (
                  <span className="line-clamp-3">{it.name}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-[var(--color-border-subtle)]">
            <th scope="row" className={rowHead}>
              {fillCopy('pdp.comparePrice')}
            </th>
            {items.map((it) => (
              <td key={it.productId} className={cell}>
                <PriceTag value={it.price} size="sm" />
              </td>
            ))}
          </tr>
          {per && (
            <tr className="border-b border-[var(--color-border-subtle)]">
              <th scope="row" className={rowHead}>
                {fillCopy(per === '100ml' ? 'pdp.compareUnit100ml' : 'pdp.compareUnit100g')}
              </th>
              {items.map((it) => (
                <td key={it.productId} className={cell}>
                  {it.unitPrice && it.unitPrice.per === per ? <PriceTag value={it.unitPrice.value} size="sm" /> : MISSING}
                </td>
              ))}
            </tr>
          )}
          {hasSize && (
            <tr className="border-b border-[var(--color-border-subtle)]">
              <th scope="row" className={rowHead}>
                {fillCopy('pdp.compareSize')}
              </th>
              {items.map((it) => (
                <td key={it.productId} className={`${cell} [overflow-wrap:anywhere]`}>
                  {it.size || MISSING}
                </td>
              ))}
            </tr>
          )}
          {hasIngredients && (
            <tr className="border-b border-[var(--color-border-subtle)]">
              <th scope="row" className={rowHead}>
                {fillCopy('pdp.compareIngredients')}
              </th>
              {items.map((it) => (
                <td key={it.productId} className={`${cell} text-xs text-[var(--color-text-secondary)] [overflow-wrap:anywhere]`}>
                  {(it.keyIngredients ?? []).length > 0 ? it.keyIngredients.join(', ') : MISSING}
                </td>
              ))}
            </tr>
          )}
          <tr>
            <td className={cell} />
            {items.map((it, i) => (
              <td key={it.productId} className="px-0 py-1">
                {i > 0 && (
                  <Link
                    href={`/san-pham/${encodeURIComponent(it.slug)}`}
                    aria-label={fillCopy('pdp.compareViewSpoken', { name: it.name })}
                    className="tubu-press inline-flex min-h-11 min-w-11 items-center px-2 text-sm font-semibold text-[var(--color-text-brand)]"
                  >
                    {fillCopy('pdp.compareView')}
                  </Link>
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </section>
  );
}
