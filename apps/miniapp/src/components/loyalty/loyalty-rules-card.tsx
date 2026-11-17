import { useId, useState, type CSSProperties } from 'react';
import { ChevronDown } from 'lucide-react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Card } from '../ui/card';
import { Icon } from '../ui/icon';
import { Heading, Text } from '../ui/text';

const TOGGLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-stack-sm)',
  width: '100%',
  padding: 'var(--space-gutter)',
  border: 'none',
  background: 'transparent',
  font: 'inherit',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
};

/**
 * Mục gập "Cách kiếm và dùng Điểm Xanh" của trang Điểm Xanh: đóng mặc định để thẻ hạng gọn, mở ra là các dòng luật tích và dùng điểm (theo cấu hình API).
 * Nút nằm trong h2 (mẫu accordion) để mục vẫn có trong danh sách tiêu đề của trang. Không có dòng nào (API cũ chưa trả tỷ lệ) thì không vẽ.
 */
export function LoyaltyRulesCard({ lines, style }: { lines: readonly string[]; style?: CSSProperties }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  if (lines.length === 0) return null;
  return (
    <Card padding={0} style={style}>
      <Heading variant="title-sm" as="h2">
        <button type="button" className="tubu-press tubu-hit-44" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)} style={TOGGLE}>
          <span style={{ minWidth: 0 }}>{fillCopy('loyalty.rulesTitle')}</span>
          <Icon icon={ChevronDown} size="sm" tone="muted" style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : undefined }} />
        </button>
      </Heading>
      <div
        id={bodyId}
        hidden={!open}
        style={{ padding: '0 var(--space-gutter) var(--space-gutter)', display: open ? 'flex' : undefined, flexDirection: 'column', gap: 'var(--space-stack-xs)' }}
      >
        {lines.map((line) => (
          <Text key={line} variant="body-sm" tone="secondary" as="p">
            {line}
          </Text>
        ))}
      </div>
    </Card>
  );
}
