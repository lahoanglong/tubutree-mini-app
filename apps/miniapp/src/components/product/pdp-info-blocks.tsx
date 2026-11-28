import { Fragment, useMemo, type CSSProperties } from 'react';
import { parseRichText, type RichBlock, type RichInline } from '@tubutree/app-core/rich-text';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Badge } from '../ui/badge';
import { Text } from '../ui/text';
import { PdpDetailRow } from './pdp-detail-row';

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

/** Dòng "Thành phần" của dải Chi tiết sản phẩm: gập sẵn, chữ phụ là số thành phần; mở ra là đủ danh sách. */
export function PdpIngredients({ items }: { items: readonly PdpIngredient[] }) {
  if (items.length === 0) return null;
  return (
    <PdpDetailRow block="ingredients" title={fillCopy('pdp.ingredients')} hint={fillCopy('pdp.ingredientsCount', { n: items.length })}>
      <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-sm)' }}>
        {items.map((ing, i) => (
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
    </PdpDetailRow>
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

/**
 * Dòng "Mô tả chi tiết" của dải Chi tiết sản phẩm: chuỗi từ Pancake/WordPress có thể là HTML; đọc qua `parseRichText` rồi vẽ như chữ nên không bao giờ hiện thẻ
 * dạng chữ. Gập sẵn; mở ra là đủ mô tả (không còn thu gọn 4 dòng bên trong).
 */
export function PdpDescription({ text, lead }: { text: string | null | undefined; lead?: string | null }) {
  // `lead`: mô tả ngắn nhiều ý (`pdpDescriptionLead`), đoạn đầu để phần Điểm nổi bật cắt bớt vẫn đọc được đủ.
  const blocks = useMemo<RichBlock[]>(() => [...(lead ? [{ kind: 'p' as const, inlines: [{ text: lead }] }] : []), ...parseRichText(text)], [lead, text]);
  if (blocks.length === 0) return null;
  return (
    <PdpDetailRow block="description" title={fillCopy('pdp.descriptionRow')}>
      <div data-testid="pdp-description-body" style={{ whiteSpace: 'pre-line' }}>
        <RichTextView blocks={blocks} />
      </div>
    </PdpDetailRow>
  );
}
