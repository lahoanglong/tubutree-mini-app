import { Fragment, useMemo, useState, type CSSProperties } from 'react';
import { ingredientsPreview } from '@tubutree/app-core/commerce/pdp-info';
import { parseRichText, richTextPlain, type RichBlock, type RichInline } from '@tubutree/app-core/rich-text';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { vi } from '../../i18n/vi';
import { haptic } from '../../utils/haptic';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { SectionTitle } from '../ui/section-title';
import { Text } from '../ui/text';

const DESC_COLLAPSED_LINES = 4;
const DESC_LONG_CHARS = 220;

const SURFACE: CSSProperties = { marginTop: 'var(--space-stack-sm)', padding: 'var(--space-inset-page)', background: 'var(--color-bg-surface)' };

/** Nút chữ "Xem thêm / Thu gọn" của một khối: Button ghost của DS (cao 44px), bỏ lề ngang để chữ thẳng mép nội dung. */
function TextToggle({ expanded, more, less, onToggle }: { expanded: boolean; more: string; less: string; onToggle: () => void }) {
  return (
    <Button
      variant="ghost"
      aria-expanded={expanded}
      onPress={() => {
        haptic('light');
        onToggle();
      }}
      style={{ minWidth: 0, paddingLeft: 0, paddingRight: 0, marginTop: 'var(--space-stack-xs)' }}
    >
      {expanded ? less : more}
    </Button>
  );
}

export interface PdpIngredient {
  name: string;
  percentage?: string | null;
  benefit?: string | null;
}

// Chấm thẳng giữa dòng đầu của tên thành phần (body-sm), không phụ thuộc cỡ chữ máy.
const DOT: CSSProperties = {
  flex: '0 0 auto',
  width: 'var(--space-inline-sm)',
  height: 'var(--space-inline-sm)',
  marginTop: 'calc((var(--type-body-sm-size) * var(--type-body-sm-lh) - var(--space-inline-sm)) / 2)',
  borderRadius: 'var(--radius-pill)',
  background: 'var(--color-text-brand)',
};

/** Thành phần: mở sẵn vài dòng đầu (`ingredientsPreview`), danh sách dài thì có nút xem đủ. */
export function PdpIngredients({ items }: { items: readonly PdpIngredient[] }) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const { shown, hidden } = ingredientsPreview(items, expanded);
  const canToggle = expanded || hidden > 0;
  return (
    <section data-pdp-block="ingredients" aria-label={fillCopy('pdp.ingredients')} style={SURFACE}>
      <SectionTitle block>{fillCopy('pdp.ingredients')}</SectionTitle>
      <ul role="list" style={{ listStyle: 'none', margin: 'var(--space-stack-sm) 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-sm)' }}>
        {shown.map((ing, i) => (
          <li key={i} style={{ display: 'flex', gap: 'var(--space-inline-sm)' }}>
            <span aria-hidden="true" style={DOT} />
            <div style={{ flex: '1 1 auto', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-inline-xs) var(--space-inline-sm)' }}>
                <Text variant="body-sm" style={{ fontWeight: 600 }}>
                  {ing.name}
                </Text>
                {ing.percentage && (
                  <Badge tone="brand" size="sm">
                    {ing.percentage}
                  </Badge>
                )}
              </div>
              {ing.benefit && (
                <Text variant="caption" tone="secondary" as="p">
                  {ing.benefit}
                </Text>
              )}
            </div>
          </li>
        ))}
      </ul>
      {canToggle && (
        <TextToggle
          expanded={expanded}
          more={fillCopy('pdp.ingredientsMore', { n: items.length })}
          less={fillCopy('pdp.ingredientsLess')}
          onToggle={() => setExpanded((e) => !e)}
        />
      )}
    </section>
  );
}

function Inlines({ items }: { items: readonly RichInline[] }) {
  return (
    <>
      {items.map((it, i) => {
        const text = it.italic ? <em>{it.text}</em> : it.text;
        return <Fragment key={i}>{it.bold ? <strong style={{ fontWeight: 600 }}>{text}</strong> : text}</Fragment>;
      })}
    </>
  );
}

/** Vẽ các khối của `parseRichText` bằng phần tử React (đoạn, tiêu đề, danh sách, đậm/nghiêng): không có đường nào đưa chuỗi HTML vào DOM. */
function RichTextView({ blocks }: { blocks: readonly RichBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        const margin = i === 0 ? 0 : 'var(--space-stack-sm) 0 0';
        if ('items' in b) {
          const List = b.kind;
          return (
            <List key={i} style={{ margin, paddingLeft: 'var(--space-inset-page)', listStyle: b.kind === 'ol' ? 'decimal' : 'disc' }}>
              {b.items.map((it, j) => (
                <li key={j}>
                  <Inlines items={it} />
                </li>
              ))}
            </List>
          );
        }
        if (b.kind === 'h') {
          return (
            <h3 key={i} style={{ margin, font: 'inherit', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              <Inlines items={b.inlines} />
            </h3>
          );
        }
        return (
          <p key={i} style={{ margin }}>
            <Inlines items={b.inlines} />
          </p>
        );
      })}
    </>
  );
}

const DESC_BODY: CSSProperties = {
  marginTop: 'var(--space-stack-xs)',
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--type-body-sm-size)',
  lineHeight: 'var(--type-body-sm-lh)',
  color: 'var(--color-text-secondary)',
  whiteSpace: 'pre-line',
  overflowWrap: 'anywhere',
};
const DESC_CLAMP: CSSProperties = { display: '-webkit-box', WebkitLineClamp: DESC_COLLAPSED_LINES, WebkitBoxOrient: 'vertical', overflow: 'hidden' };

/**
 * Mô tả sản phẩm: chuỗi từ Pancake/WordPress có thể là HTML; đọc qua `parseRichText` rồi vẽ như chữ nên không bao giờ hiện thẻ dạng chữ.
 * Dài (theo chữ thường `richTextPlain`, tính cả số dòng) thì thu gọn 4 dòng kèm nút Xem thêm.
 */
export function PdpDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const blocks = useMemo(() => parseRichText(text), [text]);
  const plain = useMemo(() => richTextPlain(blocks), [blocks]);
  if (blocks.length === 0) return null;
  const lines = plain.split('\n').filter((l) => l.trim() !== '').length;
  const isLong = plain.length > DESC_LONG_CHARS || lines > DESC_COLLAPSED_LINES;
  return (
    <section data-pdp-block="description" aria-label={vi.product.description} style={SURFACE}>
      <SectionTitle block>{vi.product.description}</SectionTitle>
      <div data-testid="pdp-description-body" style={isLong && !expanded ? { ...DESC_BODY, ...DESC_CLAMP } : DESC_BODY}>
        <RichTextView blocks={blocks} />
      </div>
      {isLong && <TextToggle expanded={expanded} more={vi.product.descriptionMore} less={vi.product.descriptionLess} onToggle={() => setExpanded((e) => !e)} />}
    </section>
  );
}
