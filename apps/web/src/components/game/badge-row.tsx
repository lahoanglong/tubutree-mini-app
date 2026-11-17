'use client';

import { Award, Lock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { badgesQuery } from '@tubutree/app-core/engagement/api';
import { badgeChips, badgeCount } from '@tubutree/app-core/engagement/view';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Card, Chip, Heading, Text } from '@/components/mini';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { GameNoticeBar, useGameNotice } from './game-notice';

/** Huy hiệu của khách (cờ engagement.badges_enabled). Cùng khoá cache cho hàng huy hiệu và cho trang Tài khoản quyết định ẩn dòng nhường chỗ. */
export function useBadges() {
  const authed = useAuthPhase() === 'authenticated';
  return useQuery({ ...badgesQuery(coreHttp), enabled: authed });
}

/**
 * Hàng huy hiệu ở Tài khoản (như Mini App): một thẻ, tiêu đề kèm "n/8", các huy hiệu cuộn ngang. Đã đạt đứng trước; chưa đạt mờ (chữ cấp
 * ba, biểu tượng khoá) và chạm vào thì báo điều kiện. Cờ tắt, chưa tải hay lỗi thì không vẽ gì (trang như trước).
 */
export function BadgeRow() {
  const q = useBadges();
  const { notice, notify } = useGameNotice();
  if (!q.data?.enabled) return null;
  const chips = badgeChips(q.data);
  return (
    <section aria-label={fillCopy('badges.title')} data-testid="badge-row" className="px-4 pt-3 md:px-0 lg:pt-0 xl:col-start-3 xl:row-start-3">
      <Card padding={12}>
        <div className="flex items-center justify-between">
          <Heading variant="title-sm" as="h2">
            {fillCopy('badges.title')}
          </Heading>
          <Text variant="caption" tone="secondary" numeric>
            {badgeCount(q.data)}
          </Text>
        </div>
        <div className="scroll-x mt-1 flex gap-2 py-1">
          {chips.map((c) => (
            <Chip
              key={c.id}
              icon={c.earned ? Award : Lock}
              ariaLabel={c.aria}
              onPress={() => notify(c.earned ? fillCopy('badges.earnedToast', { name: c.name }) : c.how, c.earned ? 'success' : 'info')}
              style={{ color: c.earned ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)' }}
            >
              {c.name}
            </Chip>
          ))}
        </div>
      </Card>
      <GameNoticeBar notice={notice} />
    </section>
  );
}
