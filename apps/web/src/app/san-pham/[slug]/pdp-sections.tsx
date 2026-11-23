'use client';

import { Fragment, useId, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Star } from 'lucide-react';
import type { PublicConfig } from '@tubutree/app-core/api/config';
import { formatRating } from '@tubutree/app-core/commerce/card-meta';
import { ingredientsPreview } from '@tubutree/app-core/commerce/pdp-info';
import { LEGAL_PAGES } from '@tubutree/app-core/legal';
import { parseRichText, richTextPlain, type RichBlock, type RichInline } from '@tubutree/app-core/rich-text';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { ProductTrustStrip } from '@/components/mini/product-trust-strip';
import { RefillLandingLink, type RefillEntryLink } from '@/components/refill/refill-landing-link';
import type { ProductDetail } from '@/lib/api';
import { ui } from '@/lib/guest-ui';
import { phoneBand, phoneBrandText } from '@/lib/phone-ui';
import { SHIPPING_POLICY_PATH, useTrustView } from './pdp-extras';

/** Tiêu đề khối trong luồng mua (Q1): Inter 16/700, -0.01em ở mọi khổ, cùng số đo với `SectionTitle block` của Mini App. Fraunces chỉ cho tiêu đề trang. */
export const pdpSectionTitle =
  'font-ui text-[length:var(--type-title-sm-size)] font-bold leading-[var(--type-title-sm-lh)] tracking-[-0.01em] text-[var(--color-text-primary)]';

/** Dải trắng riêng của nửa dưới trang ở điện thoại: cách dải trên 8px, đệm 16px như Box p=4 mt=2 của Mini App. Máy tính giữ khoảng cách mt-8. */
export const pdpBand = `mt-8 ${phoneBand}`;

const COLLAPSED_LINES_THRESHOLD = 220;

/**
 * Ngay dưới thẻ gói Refill của chai đã ghép cặp: lối sang trang mọi gói Refill (link nội bộ cho SEO). Chỉ hiện từ md (xem `RefillLandingLink`):
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
 * Thành phần: niềm tin cho khách ngại hoá chất. Mở sẵn 3 dòng (`ingredientsPreview`), nhiều hơn thì "Xem đủ (n)" / "Thu gọn". Các dòng đang gập vẫn nằm
 * trong HTML (ẩn bằng `hidden`) để công cụ tìm kiếm đọc đủ thành phần. Không có thì không dựng mục.
 */
export function PdpIngredients({ ingredients }: { ingredients: ProductDetail['ingredients'] }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  if (!ingredients || ingredients.length === 0) return null;
  const { shown, hidden } = ingredientsPreview(ingredients, expanded);
  const canToggle = expanded || hidden > 0;
  return (
    <section data-pdp-block="ingredients" data-section="pdp-ingredients" className={pdpBand}>
      <h2 className={pdpSectionTitle}>{fillCopy('pdp.ingredients')}</h2>
      <ul id={listId} className="mt-3 flex flex-col gap-2.5">
        {ingredients.map((ing, i) => (
          // `hidden` của Tailwind chứ không thuộc tính `hidden`: lớp `flex` đứng sau trong CSS sẽ thắng thuộc tính và dòng gập vẫn hiện.
          <li key={i} data-testid="pdp-ingredient" className={i < shown.length ? 'flex gap-2.5' : 'hidden'}>
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
      {canToggle && (
        <button
          type="button"
          data-testid="pdp-ingredients-toggle"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((e) => !e)}
          className={`${ui.btnText} mt-1 no-underline text-[var(--color-text-brand)] tabular-nums`}
        >
          {expanded ? fillCopy('pdp.ingredientsLess') : fillCopy('pdp.ingredientsMore', { n: ingredients.length })}
        </button>
      )}
    </section>
  );
}

/**
 * Khối cam kết cuối trang: dải ba trụ cột (`ProductTrustStrip`, hàng gian hàng tự giao không có), lối xem chính sách vận chuyển (bỏ khi lối của dải đã trỏ
 * đúng chính sách đó), `children` là nút chat ngay trong dải trắng; `rows` (Mở nhóm mua chung, Nội dung bán hàng) là các dải bấm riêng ngay bên dưới.
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
        {trust?.cta.slug !== 'van-chuyen' && (
          // Hàng riêng, cách lối chính sách của dải phía trên: hai link nằm sát hay cùng hàng với nút chat thì vùng chạm 44px chồng nhau.
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
 * Mô tả sản phẩm: chuỗi của Pancake/WordPress có thể là HTML; `parseRichText` (app-core) đọc theo danh sách thẻ cho phép thành đoạn, tiêu đề, danh sách,
 * chữ đậm/nghiêng và trang vẽ như chữ (không `innerHTML`), nên thẻ không bao giờ hiện thành chữ và không có mã lạ nào chạy. Dài thì thu gọn chừng 4 dòng
 * kèm Xem thêm; toàn bộ chữ vẫn nằm trong HTML để công cụ tìm kiếm đọc được.
 */
export function PdpDescription({ source }: { source: string | null | undefined }) {
  const [expanded, setExpanded] = useState(false);
  const blocks = useMemo(() => parseRichText(source), [source]);
  if (blocks.length === 0) return null;
  const isLong = richTextPlain(blocks).length > COLLAPSED_LINES_THRESHOLD;
  return (
    <section data-pdp-block="description" data-section="pdp-description" className={pdpBand}>
      <h2 className={pdpSectionTitle}>Mô tả sản phẩm</h2>
      <div
        id="pdp-description"
        className={`mt-2 flex flex-col gap-2 whitespace-pre-line break-words text-stone-700 max-md:mt-1.5 max-md:text-sm max-md:text-[var(--color-text-secondary)] ${isLong && !expanded ? 'max-h-24 overflow-hidden' : ''}`}
      >
        {blocks.map((b, i) => (
          <RichBlockView key={i} block={b} />
        ))}
      </div>
      {isLong && (
        <button type="button" aria-expanded={expanded} aria-controls="pdp-description" onClick={() => setExpanded((e) => !e)} className={`${ui.btnText} max-md:px-0 ${phoneBrandText}`}>
          {expanded ? 'Thu gọn' : 'Xem thêm'}
        </button>
      )}
    </section>
  );
}
