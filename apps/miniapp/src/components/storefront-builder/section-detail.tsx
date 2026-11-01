import { useEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import { Input } from 'zmp-ui';
import { ChevronLeft, Ellipsis, MessageSquarePlus, Pin, Plus } from 'lucide-react';
import {
  BUILDER_COPY, builderCopy, parseComboPct, sectionCardView, sectionStyleOf, styleLockNote, styleOptions, visibleCollection,
  type MoveDirection, type SectionStyle,
} from '@tubutree/app-core/commerce/storefront-builder';
import type { PickerProduct, StorefrontCollectionEdit, StorefrontItemEdit } from '../../services/storefront-api';
import { vi } from '../../i18n/vi';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Field } from '../ui/form';
import { Icon } from '../ui/icon';
import { LayoutPicker } from '../ui/layout-picker';
import { MoveButtons } from '../ui/move-buttons';
import { PriceTag } from '../ui/price-tag';
import { ProductThumb } from '../ui/product-thumb';
import { ShopSection } from '../ui/shop-section';
import { Text } from '../ui/text';
import { RowIconButton } from './row-icon-button';

export interface SectionDetailProps {
  col: StorefrontCollectionEdit;
  /** Dữ liệu dự phòng cho món vừa thêm chưa có `product` (API trả muộn một nhịp). */
  productMap: Map<string, PickerProduct>;
  sortMode: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  /** Kiểu vừa chọn mà máy chủ chưa lưu xong: bộ chọn hiện ngay, không chờ gửi và tải lại. */
  pickedStyle: SectionStyle | null;
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

const caption = { fontSize: 'var(--type-caption-size)', lineHeight: 'var(--type-caption-lh)' } as const;

function ComboPctField({ pct, onSave }: { pct: number | null; onSave: (n: number) => Promise<number | null> }) {
  const [text, setText] = useState(pct === null ? '' : String(pct));
  const [saving, setSaving] = useState(false);
  // Trần thật do máy chủ giữ; chỉ biết nó khi lần lưu vừa rồi bị hạ xuống, lúc đó dòng gợi ý nói đúng số ấy.
  const [cap, setCap] = useState<number | null>(null);
  const inflight = useRef(false);
  useEffect(() => setText(pct === null ? '' : String(pct)), [pct]);
  const parsed = parseComboPct(text);
  const save = async () => {
    if (parsed === null || inflight.current) return;
    inflight.current = true;
    setSaving(true);
    try {
      const saved = await onSave(parsed);
      if (saved !== null) {
        setText(String(saved));
        setCap(saved < parsed ? saved : null);
      }
    } finally {
      inflight.current = false;
      setSaving(false);
    }
  };
  const warn = cap !== null || (parsed !== null && String(parsed) !== text.trim());
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Field label={BUILDER_COPY.comboPct}>
            <Input inputMode="numeric" maxLength={3} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        </div>
        <Button variant="secondary" loading={saving} disabled={parsed === null || parsed === pct} onPress={save}>{BUILDER_COPY.comboPctSave}</Button>
      </div>
      <div data-testid="combo-pct-hint" style={{ ...caption, marginTop: 4, color: warn ? 'var(--color-status-warning-fg)' : 'var(--color-text-tertiary)' }}>
        {cap !== null ? builderCopy('comboPctClamped', { n: cap }) : BUILDER_COPY.comboPctHint}
      </div>
    </div>
  );
}

/**
 * Trang chi tiết một khối: kiểu hiển thị, mức giảm (Combo), khung "Khách sẽ thấy" dựng bằng chính `ShopSection` của trang gian hàng,
 * rồi danh sách món. Mũi tên ↑↓ chỉ có khi bật Sắp xếp, để ngoài chế độ đó mỗi hàng chỉ còn một nút ⋯.
 */
export function SectionDetail(p: SectionDetailProps) {
  const { col } = p;
  const view = sectionCardView(col, [col]);
  const shown = visibleCollection(col);
  const lockNote = styleLockNote(col.kind);

  return (
    <div data-testid="section-detail">
      <div style={{ background: 'var(--color-bg-surface)', padding: 'calc(8px + var(--safe-top)) 8px 12px' }}>
        {/* Nút lùi nổi của app (44px, cách mép trái 12px) đè lên góc trái; lối quay về danh sách khối đứng ngay sau nó. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 52 }}>
          <button
            type="button"
            className="tubu-press"
            onClick={p.onBack}
            style={{
              minHeight: 44, padding: '0 8px', display: 'flex', alignItems: 'center', gap: 2, border: 'none', background: 'transparent',
              cursor: 'pointer', font: 'inherit', color: 'var(--color-text-brand)',
            }}
          >
            <Icon icon={ChevronLeft} size="sm" tone="brand" />
            <Text variant="body-sm" tone="brand">{BUILDER_COPY.back}</Text>
          </button>
          <RowIconButton icon={Ellipsis} label={BUILDER_COPY.sectionOptions} onPress={p.onMenu} />
        </div>
        <div style={{ padding: '0 8px' }}>
          <h1
            ref={p.headingRef}
            tabIndex={-1}
            style={{
              margin: 0, outline: 'none', overflowWrap: 'anywhere', fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)',
              fontSize: 'var(--type-title-lg-size)', lineHeight: 'var(--type-title-lg-lh)', fontWeight: 'var(--type-title-lg-weight)' as unknown as number,
              letterSpacing: '-0.01em',
            }}
          >
            {col.title}
          </h1>
          <Text variant="caption" tone="tertiary" as="div">{view.countText}</Text>
        </div>
      </div>

      <div style={{ padding: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <LayoutPicker value={p.pickedStyle ?? sectionStyleOf(col)} onChange={p.onStyle} options={styleOptions(col)} lockNote={lockNote} />
        {col.kind === 'COMBO' && <ComboPctField pct={col.comboDiscountPct} onSave={p.onComboPct} />}
        {view.warnings.map((w) => (
          <div key={w} role="status" style={{ ...caption, color: 'var(--color-status-warning-fg)' }}>{w}</div>
        ))}
      </div>

      {/* Sắp xếp cần danh sách ↑↓ ngay màn đầu; khung xem trước cao cả ngàn px sẽ đẩy nó xuống, nên ẩn trong chế độ này. */}
      {shown.items.length > 0 && !p.sortMode && (
        <section style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '0 16px 6px' }}>
            <Text variant="label" tone="secondary" as="div">{BUILDER_COPY.preview}</Text>
            <Text variant="caption" tone="tertiary" as="div">{BUILDER_COPY.previewNote}</Text>
          </div>
          {/* Khung rộng đúng bề ngang màn hình, lề 16px như tab Shop thật: kệ ngang lùi lề âm đúng 16px nên thẻ đầu thẳng với tiêu đề. */}
          <div
            data-testid="shop-section-preview"
            {...({ inert: '' } as Record<string, string>)}
            style={{
              padding: '0 16px', background: 'var(--color-bg-canvas)', overflow: 'hidden',
              borderTop: '1px solid var(--color-border-subtle)', borderBottom: '1px solid var(--color-border-subtle)',
            }}
          >
            <ShopSection collection={shown} preview />
          </div>
        </section>
      )}

      <div style={{ padding: '16px 16px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Text variant="label" tone="secondary" as="div">{BUILDER_COPY.itemsHeading}</Text>
          {col.items.length > 1 && (
            <Button variant="ghost" onPress={p.onToggleSort}>{p.sortMode ? BUILDER_COPY.sortDone : BUILDER_COPY.sort}</Button>
          )}
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {col.items.map((it) => (
            <ItemRow key={it.id} it={it} list={col.items} productMap={p.productMap} p={p} />
          ))}
        </ul>
        <Button fullWidth variant="secondary" icon={Plus} style={{ marginTop: 12 }} onPress={p.onAddItem}>
          {vi.storefront.addProduct}
        </Button>
      </div>
    </div>
  );
}

function ItemRow({ it, list, productMap, p }: { it: StorefrontItemEdit; list: StorefrontItemEdit[]; productMap: Map<string, PickerProduct>; p: SectionDetailProps }) {
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
    <li data-testid="item-row" style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <ProductThumb src={prod?.thumbnail} alt="" size={p.sortMode ? 40 : 48} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text
            data-testid="item-name"
            variant="body-sm"
            as="div"
            tone={it.isHidden || it.hiddenReason ? 'tertiary' : 'primary'}
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {name}
          </Text>
          <PriceTag value={price} size="sm" />
          {(it.isPinned || it.hiddenReason) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
              {it.isPinned && <Badge tone="brand" size="sm" icon={Pin}>{vi.storefront.pinnedBadge}</Badge>}
              {it.hiddenReason && (
                <Badge tone="warning" size="sm" style={{ maxWidth: '100%', whiteSpace: 'normal' }}>
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
          <RowIconButton icon={Ellipsis} label={vi.storefront.moreItemActions} onPress={() => p.onItemMenu(it.id)} />
        )}
      </div>
      {!p.sortMode && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <button
            type="button"
            className="tubu-press"
            onClick={() => p.onNote(it.id)}
            style={{
              flex: 1, minWidth: 0, minHeight: 44, padding: 0, display: 'flex', alignItems: 'center', gap: 4,
              border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
            }}
          >
            <Icon icon={MessageSquarePlus} size="sm" tone={it.note ? 'muted' : 'brand'} style={{ flexShrink: 0 }} />
            <Text variant="caption" tone={it.note ? 'secondary' : 'brand'} style={{ fontStyle: it.note ? 'italic' : 'normal' }}>
              {it.note ? `“${it.note}”` : vi.storefront.itemNoteEmpty}
            </Text>
          </button>
          {slug && (
            <Button variant="ghost" onPress={() => p.onKit(slug)}>
              {vi.contentKit.entryLabel}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
