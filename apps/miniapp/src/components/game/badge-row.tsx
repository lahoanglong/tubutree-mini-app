import { Award, Lock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useSnackbar } from 'zmp-ui';
import { badgesQuery } from '@tubutree/app-core/engagement/api';
import { badgeChips, badgeCount } from '@tubutree/app-core/engagement/view';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { coreHttp } from '../../services/core-http';
import { useAuthStore } from '../../store/auth';
import { Card } from '../ui/card';
import { Chip } from '../ui/chip';
import { Heading, Text } from '../ui/text';

/** Huy hiệu của khách (cờ engagement.badges_enabled). Cùng khoá cache cho hàng huy hiệu và cho màn Cá nhân quyết định ẩn dòng nhường chỗ. */
export function useBadges() {
  const authed = useAuthStore((s) => s.status === 'authenticated');
  return useQuery({ ...badgesQuery(coreHttp), enabled: authed });
}

/**
 * Hàng huy hiệu ở Cá nhân: một thẻ, tiêu đề kèm "n/8", các huy hiệu cuộn ngang. Đã đạt đứng trước; chưa đạt mờ (chữ cấp ba, biểu tượng
 * khoá) và chạm vào thì báo điều kiện. Cờ tắt, chưa tải hay lỗi thì không vẽ gì (màn như trước).
 */
export function BadgeRow() {
  const q = useBadges();
  const { openSnackbar } = useSnackbar();
  if (!q.data?.enabled) return null;
  const chips = badgeChips(q.data);
  return (
    <section aria-label={fillCopy('badges.title')} data-testid="badge-row" style={{ padding: 'var(--space-inset-card) var(--space-inline-lg) 0' }}>
      <Card padding={12}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Heading variant="title-sm" as="h2">
            {fillCopy('badges.title')}
          </Heading>
          <Text variant="caption" tone="secondary" numeric>
            {badgeCount(q.data)}
          </Text>
        </div>
        <div className="scroll-x" style={{ display: 'flex', gap: 'var(--space-inline-sm)', padding: 'var(--space-stack-xs) 0', marginTop: 'var(--space-stack-xs)' }}>
          {chips.map((c) => (
            <Chip
              key={c.id}
              icon={c.earned ? Award : Lock}
              ariaLabel={c.aria}
              onPress={() => openSnackbar({ text: c.earned ? fillCopy('badges.earnedToast', { name: c.name }) : c.how, type: c.earned ? 'success' : 'info' })}
              style={{ color: c.earned ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)' }}
            >
              {c.name}
            </Chip>
          ))}
        </div>
      </Card>
    </section>
  );
}
