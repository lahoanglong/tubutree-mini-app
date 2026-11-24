import { useId, useState, type CSSProperties } from 'react';
import { ChevronDown, MapPin } from 'lucide-react';
import { pdpOriginCopy, type PdpOriginView } from '@tubutree/app-core/commerce/pdp-origin';
import { haptic } from '../../utils/haptic';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';

const BAND: CSSProperties = {
  marginTop: 'var(--space-stack-sm)',
  padding: 'var(--space-stack-xs) var(--space-inset-page)',
  background: 'var(--color-bg-surface)',
};
// Dòng tiêu đề cao bằng tiêu đề khối (`--section-header-h`), bấm cả dòng để gập/mở.
const TOGGLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-inline-sm)',
  width: '100%',
  minHeight: 'var(--section-header-h)',
  padding: 0,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'left',
  color: 'var(--color-text-primary)',
};
const TITLE: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  fontSize: 'var(--type-title-sm-size)',
  lineHeight: 'var(--type-title-sm-lh)',
  fontWeight: 700,
  letterSpacing: '-0.01em',
};
const HINT: CSSProperties = { flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const LIST: CSSProperties = { margin: 0, padding: '0 0 var(--space-stack-sm)', display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-sm)' };
const MAP_LINK: CSSProperties = {
  display: 'inline-flex',
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
 * Khối "Nguồn gốc & cách dùng" (`pdpOriginView` của app-core): gập sẵn thành một dòng tiêu đề kèm tỉnh vùng nguyên liệu để đọc lướt, mở ra là
 * các dòng Vùng nguyên liệu, Cách dùng, Bảo quản, Hạn dùng/số lô. Cùng số đo với khối web (`pdp-origin-guide.tsx`, thẻ `<details>`).
 * Lối bản đồ chỉ có khi đầu trang chưa có chip xuất xứ (`view.map`), để một hành động chỉ có một lối.
 */
export function PdpOriginGuide({ view, onOpenMap }: { view: PdpOriginView | null; onOpenMap: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  if (!view) return null;
  return (
    <section data-pdp-block="origin" data-testid="pdp-origin" aria-label={view.title} style={BAND}>
      <button
        type="button"
        className="tubu-press tubu-hit-44"
        data-testid="pdp-origin-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => {
          haptic('light');
          setOpen((o) => !o);
        }}
        style={TOGGLE}
      >
        <span style={TITLE}>{view.title}</span>
        {view.hint && !open && (
          <Text variant="caption" tone="secondary" style={HINT}>
            {view.hint}
          </Text>
        )}
        <Icon icon={ChevronDown} size="sm" tone="muted" style={{ flex: 'none', transform: open ? 'rotate(180deg)' : undefined }} />
      </button>
      <dl id={bodyId} hidden={!open} style={LIST}>
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
            </Text>
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
          </div>
        ))}
      </dl>
    </section>
  );
}
