import type { LucideIcon } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { Icon } from '../ui/icon';
import { ListRow } from '../ui/list-row';

export function GameLinkRow({
  icon,
  title,
  hint,
  badge,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <Card variant="outline" padding={0}>
      <ListRow
        icon={
          <span
            aria-hidden
            style={{
              width: 36,
              height: 36,
              borderRadius: 'var(--radius-control)',
              background: 'var(--color-bg-subtle)',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <Icon icon={icon} tone="brand" />
          </span>
        }
        title={
          badge ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {title}
              <Badge tone="brand" size="sm">
                {badge}
              </Badge>
            </span>
          ) : (
            title
          )
        }
        subtitle={hint}
        trailing="chevron"
        onPress={onClick}
        style={{ padding: '8px 16px' }}
      />
    </Card>
  );
}
