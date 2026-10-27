import { Leaf } from 'lucide-react';
import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';
import type { Season } from '../../services/game-api';
import { Card } from '../ui/card';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';

// Emoji của loài nổi bật là dữ liệu từ máy chủ (nội dung game).
export function SeasonBanner({ season }: { season: Season }) {
  return (
    <Card variant="flat" padding={12} style={{ border: '1px solid var(--forest-200)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text variant="body-sm" tone="brand" style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon icon={Leaf} size="sm" tone="brand" />
          {season.name}
        </Text>
        <Text variant="body-lg">{season.featuredSpecies.map((s) => s.emoji).join(' ')}</Text>
      </div>
      {(season.theme || season.region) && (
        <Text variant="caption" tone="secondary" as="div">
          {[season.theme, season.region].filter(Boolean).join(' · ')}
        </Text>
      )}
      {season.featuredSpecies.length > 0 && (
        <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 2 }}>
          Loài nổi bật mùa này: {season.featuredSpecies.map((s) => s.name).join(', ')}
        </Text>
      )}
    </Card>
  );
}

/** Không có mùa nào đang chạy (chưa tạo mùa mới hoặc mùa cũ đã hết hạn): nói rõ thay vì để trống hay hiện mùa cũ. */
export function SeasonEmpty() {
  return (
    <div data-testid="season-empty">
    <Card variant="flat" padding={12} style={{ border: '1px solid var(--color-border-subtle)' }}>
      <Text variant="body-sm" tone="secondary" style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Icon icon={Leaf} size="sm" tone="muted" />
        {gameNewbieCopy.seasonEmpty.title}
      </Text>
      <Text variant="caption" tone="tertiary" as="div">
        {gameNewbieCopy.seasonEmpty.body}
      </Text>
    </Card>
    </div>
  );
}
