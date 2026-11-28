'use client';

import { Fragment, useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { Star } from 'lucide-react';
import type { PublicConfig } from '@tubutree/app-core/api/config';
import { formatRating } from '@tubutree/app-core/commerce/card-meta';
import { LEGAL_PAGES } from '@tubutree/app-core/legal';
import { parseRichText, type RichBlock, type RichInline } from '@tubutree/app-core/rich-text';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { ProductTrustStrip } from '@/components/mini/product-trust-strip';
import { RefillLandingLink, type RefillEntryLink } from '@/components/refill/refill-landing-link';
import type { ProductDetail } from '@/lib/api';
import { ui } from '@/lib/guest-ui';
import { phoneBrandText } from '@/lib/phone-ui';
import { PdpDetailRow } from '@/components/mini/pdp-detail-row';
import { SHIPPING_POLICY_PATH, useTrustView } from './pdp-extras';
import { pdpBand, pdpSectionTitle } from './pdp-ui';

export { pdpBand, pdpSectionTitle };

/**
 * Ngay dưới dải chọn cách mua của chai đã ghép gói Refill: lối sang trang mọi gói Refill (link nội bộ cho SEO). Chỉ hiện từ md (xem `RefillLandingLink`):
 * thẻ Refill ở điện thoại giữ đúng một khối như Mini App.
 */
export function PdpRefillLandingLink({ entry }: { entry: RefillEntryLink }) {
  return <RefillLandingLink entry={entry} testId="pdp-refill-landing" className="mt-1" />;
}

/** Sao và điểm trung bình ở đầu trang, chỉ khi đã có đánh giá. */
export function PdpRating({ average, count }: { average: number | undefined; count: number | undefined }) {
  if (!count || count <= 0 || average == null) return null;
  return (
    <p data-testid="pdp-rating" className="flex items-center gap-1.5 text-sm text-stone-600">
      <span role="img" aria-label={`${formatRating(average)} trên 5 sao`} className="flex">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star key={n} aria-hidden="true" className={`h-3.5 w-3.5 ${n <= Math.round(average) ? 'fill-promo-solid text-promo-solid' : 'text-stone-300'}`} />
        ))}
      </span>
      <span>
        {formatRating(average)} · {count} đánh giá
      </span>
    </p>
  );
}

/**
 * Dòng "Thành phần" của dải Chi tiết sản phẩm (w47-01): gập sẵn, chữ phụ là số thành phần; mở ra là đủ danh sách. Dòng đang gập vẫn nằm trong HTML
 * (thuộc tính `hidden` của `PdpDetailRow`) để công cụ tìm kiếm đọc đủ thành phần. Không có thì không dựng mục.
 */
export function PdpIngredients({ ingredients }: { ingredients: ProductDetail['ingredients'] }) {
  if (!ingredients || ingredients.length === 0) return null;
  return (
    <PdpDetailRow block="ingredients" title={fillCopy('pdp.ingredients')} hint={fillCopy('pdp.ingredientsCount', { n: ingredients.length })}>
      <ul className="flex flex-col gap-2.5">
        {ingredients.map((ing, i) => (
          <li key={i} data-testid="pdp-ingredient" className="flex gap-2.5">
            <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[var(--color-text-brand)]" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">{ing.name}</span>
                {ing.percentage && <span className="rounded-full bg-[var(--color-bg-subtle)] px-1.5 py-px text-xs text-[var(--color-text-brand)]">{ing.percentage}</span>}
              </div>
              {ing.benefit && <p className="text-sm text-[var(--color-text-secondary)]">{ing.benefit}</p>}
            </div>
          </li>
        ))}
      </ul>
    </PdpDetailRow>
  );
}

/**
 * Khối cam kết cuối trang: dải ba trụ cột (`ProductTrustStrip`, hàng gian hàng tự giao không có), `children` là nút chat ngay trong dải trắng; `rows`
 * (Mở nhóm mua chung, Nội dung bán hàng) là các dải bấm riêng ngay bên dưới. Hàng Tubu đã có lối tới chính sách vận chuyển ở dòng "Vận chuyển ›" và dải
 * ba trụ cột nên khối không thêm link; khi không có dải (hàng gian hàng, không giao được) link là lối duy nhất tới chính sách.
 */
export function PdpPromises({
  fulfillerKind,
  initialConfig,
  children,
  rows,
}: {
  fulfillerKind: string | undefined;
  initialConfig?: PublicConfig;
  children?: ReactNode;
  rows?: ReactNode;
}) {
  const trust = useTrustView(fulfillerKind, initialConfig);
  return (
    <div data-pdp-block="promises">
      <div data-section="pdp-promises" className={pdpBand}>
        <ProductTrustStrip view={trust} />
        {!trust && (
          // Hàng riêng, cách nút chat: hai lối nằm cùng hàng thì vùng chạm 44px chồng nhau.
          <div className="mt-2">
            <Link href={SHIPPING_POLICY_PATH} data-testid="pdp-shipping-policy" className={`${ui.btnText} ${phoneBrandText}`}>
              {LEGAL_PAGES['van-chuyen'].title}
            </Link>
          </div>
        )}
        {children}
      </div>
      {rows}
    </div>
  );
}

function Inlines({ inlines }: { inlines: readonly RichInline[] }) {
  return (
    <>
      {inlines.map((it, i) => {
        let node: ReactNode = it.text;
        if (it.italic) node = <em>{node}</em>;
        if (it.bold) node = <strong className="font-semibold">{node}</strong>;
        return <Fragment key={i}>{node}</Fragment>;
      })}
    </>
  );
}

function RichBlockView({ block }: { block: RichBlock }) {
  if (block.kind === 'h') {
    return (
      <h3 className="font-semibold text-[var(--color-text-primary)]">
        <Inlines inlines={block.inlines} />
      </h3>
    );
  }
  if (block.kind === 'p') {
    return (
      <p>
        <Inlines inlines={block.inlines} />
      </p>
    );
  }
  const List = block.kind;
  return (
    <List className={`flex flex-col gap-1 pl-5 ${block.kind === 'ul' ? 'list-disc' : 'list-decimal'}`}>
      {block.items.map((item, i) => (
        <li key={i}>
          <Inlines inlines={item} />
        </li>
      ))}
    </List>
  );
}

/**
 * Dòng "Mô tả chi tiết" của dải Chi tiết sản phẩm (w47-01): chuỗi của Pancake/WordPress có thể là HTML; `parseRichText` (app-core) đọc theo danh sách thẻ
 * cho phép thành đoạn, tiêu đề, danh sách, chữ đậm/nghiêng và trang vẽ như chữ (không `innerHTML`), nên thẻ không bao giờ hiện thành chữ. Gập sẵn; toàn
 * bộ chữ vẫn nằm trong HTML để công cụ tìm kiếm đọc được.
 */
export function PdpDescription({ source, lead }: { source: string | null | undefined; lead?: string | null }) {
  // `lead`: mô tả ngắn nhiều ý (`pdpDescriptionLead`), đoạn đầu để phần Điểm nổi bật cắt bớt vẫn đọc được đủ.
  const blocks = useMemo<RichBlock[]>(() => [...(lead ? [{ kind: 'p' as const, inlines: [{ text: lead }] }] : []), ...parseRichText(source)], [lead, source]);
  if (blocks.length === 0) return null;
  return (
    <PdpDetailRow block="description" title={fillCopy('pdp.descriptionRow')}>
      <div data-testid="pdp-description-body" className="flex flex-col gap-2 whitespace-pre-line break-words">
        {blocks.map((b, i) => (
          <RichBlockView key={i} block={b} />
        ))}
      </div>
    </PdpDetailRow>
  );
}
