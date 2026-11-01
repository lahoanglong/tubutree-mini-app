'use client';

import { useState } from 'react';
import { Check, Star } from 'lucide-react';
import { returnsPromise } from '@tubutree/app-core/returns-copy';
import type { ProductDetail } from '@/lib/api';
import { usePublicConfig } from '@/lib/use-public-config';
import { ui } from '@/lib/guest-ui';

/** Tiêu đề khối trong luồng mua (Q1): Inter 16/700, -0.01em ở mọi khổ, cùng số đo với `SectionTitle block` của Mini App. Fraunces chỉ cho tiêu đề trang. */
export const pdpSectionTitle =
  'font-ui text-[length:var(--type-title-sm-size)] font-bold leading-[var(--type-title-sm-lh)] tracking-[-0.01em] text-[var(--color-text-primary)]';

/** Dải trắng riêng của nửa dưới trang ở điện thoại: cách dải trên 8px, đệm 16px như Box p=4 mt=2 của Mini App. Máy tính giữ khoảng cách mt-8. */
export const pdpBand = 'mt-8 max-md:mt-2 max-md:bg-[var(--color-bg-surface)] max-md:p-4';

const COLLAPSED_LINES_THRESHOLD = 220;

/** Sao và điểm trung bình ở đầu trang, chỉ khi đã có đánh giá. */
export function PdpRating({ average, count }: { average: number | undefined; count: number | undefined }) {
  if (!count || count <= 0 || average == null) return null;
  return (
    <p data-testid="pdp-rating" className="flex items-center gap-1.5 text-sm text-stone-600">
      <span role="img" aria-label={`${average.toFixed(1)} trên 5 sao`} className="flex">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star key={n} aria-hidden="true" className={`h-3.5 w-3.5 ${n <= Math.round(average) ? 'fill-promo-solid text-promo-solid' : 'text-stone-300'}`} />
        ))}
      </span>
      <span>
        {average.toFixed(1)} · {count} đánh giá
      </span>
    </p>
  );
}

/** Thành phần: niềm tin cho khách ngại hoá chất. Không có thì không dựng mục. */
export function PdpIngredients({ ingredients }: { ingredients: ProductDetail['ingredients'] }) {
  if (!ingredients || ingredients.length === 0) return null;
  return (
    <section data-section="pdp-ingredients" className={pdpBand}>
      <h2 className={pdpSectionTitle}>Thành phần</h2>
      <ul className="mt-3 flex flex-col gap-2.5">
        {ingredients.map((ing, i) => (
          <li key={i} className="flex gap-2.5">
            <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-forest-600" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-stone-900">{ing.name}</span>
                {ing.percentage && <span className="rounded-full bg-forest-50 px-1.5 py-px text-xs text-forest-700">{ing.percentage}</span>}
              </div>
              {ing.benefit && <p className="text-sm text-stone-600">{ing.benefit}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Cam kết Tubu: tín hiệu an tâm trước khi mua; `children` là chỗ cho nút chat OA. */
export function PdpPromises({ children }: { children?: React.ReactNode }) {
  const { returnWindowDays } = usePublicConfig();
  const promises = ['Hàng chính hãng — nguồn gốc rõ ràng', returnsPromise(returnWindowDays), 'Sản phẩm xanh, an lành cho cả nhà'].filter((t): t is string => t !== null);
  return (
    <section id="pdp-promises" data-section="pdp-promises" className={`${pdpBand} scroll-mt-20`}>
      <h2 className={pdpSectionTitle}>Cam kết Tubu</h2>
      <ul className="mt-2 flex flex-col gap-1.5">
        {promises.map((t) => (
          <li key={t} className="flex items-center gap-2 text-sm text-stone-700 max-md:text-xs max-md:text-[var(--color-text-secondary)]">
            <Check className="h-4 w-4 shrink-0 text-forest-600" aria-hidden="true" />
            {t}
          </li>
        ))}
      </ul>
      {children}
    </section>
  );
}

/** Mô tả thu gọn 4 dòng + nút Xem thêm; toàn bộ chữ vẫn nằm trong HTML để công cụ tìm kiếm đọc được. */
export function PdpDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > COLLAPSED_LINES_THRESHOLD;
  return (
    <section data-section="pdp-description" className={pdpBand}>
      <h2 className={pdpSectionTitle}>Mô tả sản phẩm</h2>
      <p id="pdp-description" className={`mt-2 whitespace-pre-line break-words text-stone-700 max-md:mt-1.5 max-md:text-sm max-md:text-[var(--color-text-secondary)] ${isLong && !expanded ? 'line-clamp-4' : ''}`}>
        {text}
      </p>
      {isLong && (
        <button type="button" aria-expanded={expanded} aria-controls="pdp-description" onClick={() => setExpanded((e) => !e)} className={`${ui.btnText} max-md:px-0 max-md:no-underline max-md:text-[color:var(--color-text-brand)]`}>
          {expanded ? 'Thu gọn' : 'Xem thêm'}
        </button>
      )}
    </section>
  );
}
