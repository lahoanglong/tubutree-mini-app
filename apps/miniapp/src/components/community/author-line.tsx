import { Leaf } from 'lucide-react';
import { vi } from '../../i18n/vi';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';
import { RankBadge } from './rank-badge';

export function ExpertBadge() {
  return (
    <Text variant="label" tone="brand" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      <Icon icon={Leaf} size="sm" tone="brand" />
      {vi.community.expert}
    </Text>
  );
}

/**
 * Khối chữ của hàng tác giả: tên MỘT dòng (dài thì cắt "…"), huy hiệu chuyên gia/hạng nằm dòng dưới cùng với dòng phụ
 * (thời gian, danh mục) và tự xuống dòng khi chật. Trước đây hai huy hiệu chen cùng hàng với tên nên tên dài gãy hai dòng.
 * `minWidth: 0` để khối co được trong hàng flex của avatar + nút bên phải.
 */
export function AuthorLine({
  name,
  badge,
  level,
  meta,
  size = 'sm',
}: {
  name: string;
  badge?: string | null;
  level: number;
  /** Dòng phụ cạnh huy hiệu: thời gian · danh mục. */
  meta?: string;
  size?: 'sm' | 'lg';
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <Text
        variant={size === 'lg' ? 'body-lg' : 'body-sm'}
        as="div"
        style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {name}
      </Text>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 6 }}>
        {badge === 'EXPERT' && <ExpertBadge />}
        <RankBadge level={level} />
        {meta && (
          <Text variant="caption" tone="tertiary">
            {meta}
          </Text>
        )}
      </div>
    </div>
  );
}
