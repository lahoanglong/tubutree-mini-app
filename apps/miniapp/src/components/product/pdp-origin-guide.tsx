import type { CSSProperties } from 'react';
import { MapPin } from 'lucide-react';
import { pdpOriginCopy, type PdpOriginView } from '@tubutree/app-core/commerce/pdp-origin';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';
import { PdpDetailRow } from './pdp-detail-row';

const LIST: CSSProperties = { margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-sm)' };
const MAP_LINK: CSSProperties = {
  display: 'flex',
  width: 'fit-content',
  alignItems: 'center',
  gap: 'var(--space-inline-xs)',
  padding: 0,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 'var(--type-caption-size)',
  lineHeight: 'var(--type-caption-lh)',
  fontWeight: 600,
  color: 'var(--color-text-brand)',
};

/**
 * Dòng "Nguồn gốc & cách dùng" của dải Chi tiết sản phẩm (`pdpOriginView` của app-core): gập sẵn kèm tỉnh của nhãn để đọc lướt, mở ra là các dòng
 * Đến từ, Cách dùng, Bảo quản, Hạn dùng/số lô. Cùng số đo với khối web (`pdp-origin-guide.tsx`).
 * Lối bản đồ chỉ có khi đầu trang chưa có chip xuất xứ (`view.map`), để một hành động chỉ có một lối.
 */
export function PdpOriginGuide({ view, onOpenMap }: { view: PdpOriginView | null; onOpenMap: (id: string) => void }) {
  if (!view) return null;
  return (
    <PdpDetailRow block="origin" title={view.title} hint={view.hint}>
      <dl style={LIST}>
        {view.rows.map((row) => (
          <div key={row.key} data-testid={`pdp-origin-${row.key}`}>
            <Text variant="caption" tone="secondary" as="dt">
              {row.label}
            </Text>
            <Text variant="body-sm" as="dd" style={{ margin: 0 }}>
              {row.lines.length > 1 ? (
                <ul style={{ margin: 0, paddingLeft: 'var(--space-inset-page)', listStyle: 'disc' }}>
                  {row.lines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              ) : (
                row.lines[0]
              )}
              {row.key === 'origin' && view.map && (
                <button
                  type="button"
                  className="tubu-press tubu-hit-44"
                  data-testid="pdp-origin-map"
                  aria-label={view.map.spoken}
                  onClick={() => onOpenMap(view.map!.id)}
                  style={MAP_LINK}
                >
                  <Icon icon={MapPin} size="sm" tone="brand" style={{ flex: 'none' }} />
                  {pdpOriginCopy('map')}
                </button>
              )}
            </Text>
          </div>
        ))}
      </dl>
    </PdpDetailRow>
  );
}
