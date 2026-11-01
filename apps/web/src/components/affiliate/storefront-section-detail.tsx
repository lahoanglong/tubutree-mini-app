'use client';

import { useEffect, useState, type Ref } from 'react';
import { ChevronLeft, Ellipsis, MessageSquarePlus, Pin, Plus } from 'lucide-react';
import {
  BUILDER_COPY, parseComboPct, sectionCardView, sectionStyleOf, styleLockNote, styleOptions, visibleCollection,
  type MoveDirection, type SectionStyle,
} from '@tubutree/app-core/commerce/storefront-builder';
import type { PickerProduct, StorefrontCollectionEdit, StorefrontItemEdit } from '@tubutree/app-core/api/storefront';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { phoneBrandText, phoneSecondary } from '@/lib/phone-ui';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { LayoutPicker } from '@/components/mini/layout-picker';
import { MoveButtons } from '@/components/mini/move-buttons';
import { ProductThumb } from '@/components/mini/product-thumb';
import { ShopSection } from '@/components/mini/shop-section';

export interface StorefrontSectionDetailProps {
  col: StorefrontCollectionEdit;
  /** Dữ liệu dự phòng cho món vừa thêm chưa có `product` (API trả muộn một nhịp). */
  productMap: Map<string, PickerProduct>;
  sortMode: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  /** Kiểu đang gửi lên máy chủ: bộ chọn hiện ngay, không chờ tải lại. */
  layoutBusy: SectionStyle | null;
  onBack: () => void;
  onMenu: () => void;
  onStyle: (style: SectionStyle) => void;
  /** Lưu mức giảm; trả mức máy chủ đã lưu (có thể thấp hơn mức gửi), null khi lỗi. */
  onComboPct: (pct: number) => Promise<number | null>;
  onAddItem: () => void;
  onToggleSort: () => void;
  onMoveItem: (itemId: string, dir: MoveDirection) => void;
  onMoveBlocked: (itemId: string, dir: MoveDirection) => void;
  onItemMenu: (itemId: string) => void;
  onNote: (itemId: string) => void;
  onKit: (slug: string) => void;
}

const samePinGroup = (a: { isPinned: boolean }, b: { isPinned: boolean }) => a.isPinned === b.isPinned;

function ComboPctField({ pct, onSave }: { pct: number | null; onSave: (n: number) => Promise<number | null> }) {
  const [text, setText] = useState(pct === null ? '' : String(pct));
  const [saving, setSaving] = useState(false);
  useEffect(() => setText(pct === null ? '' : String(pct)), [pct]);
  const parsed = parseComboPct(text);
  const save = async () => {
    if (parsed === null || saving) return;
    setSaving(true);
    const saved = await onSave(parsed);
    setSaving(false);
    if (saved !== null) setText(String(saved));
  };
  return (
    <div>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field label={BUILDER_COPY.comboPct}>
            <input className={ui.field} aria-label={BUILDER_COPY.comboPct} inputMode="numeric" maxLength={3} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        </div>
        <button type="button" className={`${ui.btnSecondary} ${phoneSecondary}`} disabled={parsed === null || parsed === pct || saving} onClick={() => void save()}>
          {BUILDER_COPY.comboPctSave}
        </button>
      </div>
      <p className="mt-1 text-xs text-stone-600">{BUILDER_COPY.comboPctHint}</p>
    </div>
  );
}

function MenuButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button type="button" aria-label={label} onClick={onPress} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-stone-600 hover:bg-stone-100">
      <Ellipsis className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

/**
 * Trang chi tiết một khối: kiểu hiển thị, mức giảm (Combo), khung "Khách sẽ thấy" dựng bằng chính `ShopSection` của trang gian hàng,
 * rồi danh sách món. Mũi tên ↑↓ chỉ có khi bật Sắp xếp, để ngoài chế độ đó mỗi hàng chỉ còn một nút ⋯. Tiêu đề khối là h2: h1 của trang
 * vẫn là "Gian hàng của tôi".
 */
export function StorefrontSectionDetail(p: StorefrontSectionDetailProps) {
  const { col } = p;
  const view = sectionCardView(col, [col]);
  const shown = visibleCollection(col);
  const lockNote = styleLockNote(col.kind);

  return (
    <div data-testid="section-detail" className="space-y-4">
      <div>
        <div className="-ml-2 flex items-center justify-between">
          <button type="button" onClick={p.onBack} className="inline-flex min-h-11 items-center gap-0.5 px-2 text-sm font-medium text-forest-700">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {BUILDER_COPY.back}
          </button>
          <MenuButton label="Tuỳ chọn bộ sưu tập" onPress={p.onMenu} />
        </div>
        <h2 ref={p.headingRef} tabIndex={-1} className="break-words font-display text-xl font-semibold text-stone-900 outline-none">
          {col.title}
        </h2>
        <p className="text-xs text-stone-600">{view.countText}</p>
      </div>

      <LayoutPicker value={p.layoutBusy ?? sectionStyleOf(col)} onChange={p.onStyle} options={styleOptions(col)} lockNote={lockNote} />
      {col.kind === 'COMBO' && <ComboPctField pct={col.comboDiscountPct} onSave={p.onComboPct} />}
      {view.warnings.map((w) => (
        <div key={w} role="status" className="text-xs text-warning-fg">
          {w}
        </div>
      ))}

      {shown.items.length > 0 && (
        <section>
          <div className="mb-1.5 text-xs font-medium text-stone-700">{BUILDER_COPY.preview}</div>
          {/* Khung rộng đúng bề ngang màn hình ở điện thoại, lề 16px như tab Shop thật: kệ ngang lùi lề âm đúng 16px nên thẻ đầu thẳng với tiêu đề. */}
          <div data-testid="shop-section-preview" inert className="tubu-bleed overflow-hidden border-y border-stone-200 bg-stone-50 px-4 md:rounded-card md:border">
            <ShopSection collection={shown} preview />
          </div>
        </section>
      )}

      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-stone-700">{BUILDER_COPY.itemsHeading}</div>
          {col.items.length > 1 && (
            <button type="button" className={`${ui.btnText} ${phoneBrandText}`} onClick={p.onToggleSort}>
              {p.sortMode ? BUILDER_COPY.sortDone : BUILDER_COPY.sort}
            </button>
          )}
        </div>
        <ul className="grid list-none gap-x-6 p-0 md:grid-cols-2">
          {col.items.map((it) => (
            <ItemRow key={it.id} it={it} list={col.items} productMap={p.productMap} p={p} />
          ))}
        </ul>
        <button type="button" className={`${ui.btnSecondary} ${phoneSecondary} mt-3`} onClick={p.onAddItem}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          Thêm sản phẩm
        </button>
      </div>
    </div>
  );
}

function ItemRow({ it, list, productMap, p }: { it: StorefrontItemEdit; list: StorefrontItemEdit[]; productMap: Map<string, PickerProduct>; p: StorefrontSectionDetailProps }) {
  const prod = it.product ?? productMap.get(it.productId);
  const name = prod?.name ?? 'Sản phẩm';
  const price = prod?.salePrice ?? prod?.basePrice ?? 0;
  const slug = prod?.slug;
  const at = list.findIndex((x) => x.id === it.id);
  const canMove = (dir: MoveDirection) => {
    const to = dir === 'up' ? at - 1 : at + 1;
    return to >= 0 && to < list.length && samePinGroup(it, list[to]!);
  };

  return (
    <li data-testid="item-row" className="border-b border-stone-200 py-2">
      <div className="flex items-center gap-2.5">
        <ProductThumb src={prod?.thumbnail} alt="" size={p.sortMode ? 40 : 48} />
        <div className="min-w-0 flex-1">
          <div data-testid="item-name" className={`truncate text-sm ${it.isHidden || it.hiddenReason ? 'text-stone-500' : 'text-stone-900'}`}>
            {name}
          </div>
          <div className="text-sm font-semibold tabular-nums text-stone-900">{formatVnd(price)}</div>
          {(it.isPinned || it.hiddenReason) && (
            <div className="mt-0.5 flex flex-wrap gap-1">
              {it.isPinned && (
                <Badge tone="brand" size="sm" icon={Pin}>
                  Đã ghim
                </Badge>
              )}
              {it.hiddenReason && (
                <Badge tone="warning" size="sm" className="max-w-full !whitespace-normal">
                  Khách không thấy: {it.hiddenReason}
                </Badge>
              )}
            </div>
          )}
        </div>
        {p.sortMode ? (
          <MoveButtons
            id={it.id}
            name={name}
            canUp={canMove('up')}
            canDown={canMove('down')}
            onMove={(dir) => p.onMoveItem(it.id, dir)}
            onBlocked={(dir) => p.onMoveBlocked(it.id, dir)}
          />
        ) : (
          <MenuButton label="Tuỳ chọn sản phẩm" onPress={() => p.onItemMenu(it.id)} />
        )}
      </div>
      {!p.sortMode && (
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => p.onNote(it.id)}
            className={`flex min-h-11 min-w-0 flex-1 items-center gap-1 text-left text-xs ${it.note ? 'italic text-stone-700' : 'text-forest-700'}`}
          >
            <MessageSquarePlus className="h-4 w-4 shrink-0" aria-hidden="true" />
            {it.note ? `“${it.note}”` : 'Thêm lý do giới thiệu'}
          </button>
          {slug && (
            <button type="button" className={`${ui.btnText} ${phoneBrandText}`} onClick={() => p.onKit(slug)}>
              Bài đăng mẫu
            </button>
          )}
        </div>
      )}
    </li>
  );
}
