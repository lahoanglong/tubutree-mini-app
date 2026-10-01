import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { Map as MapIcon, MessagesSquare, Search, Sparkles, Users, type LucideIcon } from 'lucide-react';
import { fetchBrands } from '../../services/shop-api';
import { useAuthStore } from '../../store/auth';
import { vi } from '../../i18n/vi';
import { haptic } from '../../utils/haptic';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Chip } from '../ui/chip';
import { Icon } from '../ui/icon';
import { ListRow } from '../ui/list-row';
import { Skeleton } from '../ui/skeleton';
import { Heading, Text } from '../ui/text';

// Khung chờ dải thương hiệu: Chip size md cao 36px (minHeight của Chip); 5 ô giống bản cũ.
// Chiều cao cả hàng = 36 + đệm dọc 6*2 (≥4px để vùng chạm 44px của Chip không bị overflow cắt).
const BRAND_CHIP_HEIGHT = 36;
const BRAND_CHIP_SKELETON_COUNT = 5;
const BRAND_CHIP_SKELETON_WIDTH = 92;
const BRAND_RAIL_PADDING = '6px 0';

/**
 * Khối phụ cuối Trang chủ (spec 5b.1, plan 4b Ruling 8): 2 nút AI/Mua chung xuống thành thẻ nhỏ,
 * hero thương hiệu với CTA "Tìm sản phẩm" (A2-33), dải thương hiệu, câu chuyện nguyên liệu, cộng đồng.
 */
export function HomeExtras() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  // Brand chậm đổi (sync Pancake ~15p/lần) → cache 60s, override default 10s.
  const brands = useQuery({ queryKey: ['brands'], queryFn: fetchBrands, staleTime: 60_000 });
  const go = (to: string) => {
    haptic('light');
    navigate(to);
  };
  const brandList = brands.data ?? [];

  return (
    <div style={{ padding: '16px 16px 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <ShortcutCard icon={Sparkles} label={vi.home.aiCard} ariaLabel={vi.home.aiCardLabel} onPress={() => go('/ai-advisor')} />
        <ShortcutCard icon={Users} label={vi.home.groupBuyCard} ariaLabel={vi.home.groupBuyCard} onPress={() => go('/group-buy')} />
      </div>

      <Card variant="flat" padding={16}>
        <Text variant="label" tone="brand" as="div">
          {vi.home.heroKicker}
        </Text>
        <Heading variant="title-md" as="h2" style={{ marginTop: 4 }}>
          {vi.home.heroTitle}
        </Heading>
        {user && (
          <Text variant="body-sm" tone="secondary" as="p" style={{ marginTop: 4 }}>
            {vi.home.greeting(user.fullName ?? vi.auth.greetingFallback)}
            {user.pointsBalance != null ? ` · ${vi.home.pointsChip(user.pointsBalance)}` : ''}
          </Text>
        )}
        <div style={{ marginTop: 12 }}>
          <Button variant="secondary" icon={Search} onPress={() => go('/browse?focus=search')} style={{ minWidth: 0 }}>
            {vi.home.heroCta}
          </Button>
        </div>
      </Card>

      {(brands.isLoading || brandList.length > 0) && (
        <section aria-label={vi.home.brandsTitle}>
          <Heading variant="title-sm" as="h2" style={{ marginBottom: 4 }}>
            {vi.home.brandsTitle}
          </Heading>
          <div className="scroll-x" style={{ gap: 8, padding: BRAND_RAIL_PADDING }}>
            {brands.isLoading
              ? Array.from({ length: BRAND_CHIP_SKELETON_COUNT }, (_, i) => (
                  <div key={i} data-testid="brand-chip-skeleton" style={{ flex: '0 0 auto' }}>
                    <Skeleton width={BRAND_CHIP_SKELETON_WIDTH} height={BRAND_CHIP_HEIGHT} radius="var(--radius-pill)" />
                  </div>
                ))
              : brandList.map((b) => (
                  <Chip key={b.brand} onPress={() => go(`/browse?brand=${encodeURIComponent(b.brand)}`)}>
                    {b.brand}
                  </Chip>
                ))}
          </div>
        </section>
      )}

      <Card variant="outline" padding={0}>
        <ListRow
          icon={<Icon icon={MapIcon} tone="brand" />}
          title={vi.home.brandStoryTitle}
          subtitle={vi.home.brandStoryBody}
          trailing="chevron"
          onPress={() => go('/brand-story')}
          style={{ padding: '12px' }}
        />
        <ListRow
          icon={<Icon icon={MessagesSquare} tone="brand" />}
          title={vi.community.title}
          subtitle={vi.community.subtitle}
          trailing="chevron"
          onPress={() => go('/feed')}
          style={{ padding: '12px', borderTop: '1px solid var(--color-border-subtle)' }}
        />
      </Card>
    </div>
  );
}

function ShortcutCard({ icon, label, ariaLabel, onPress }: { icon: LucideIcon; label: string; ariaLabel: string; onPress: () => void }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className="tubu-press"
      onClick={onPress}
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 44,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--color-border-subtle)',
        background: 'var(--color-bg-surface)',
        boxSizing: 'border-box',
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'inherit',
      }}
    >
      <Icon icon={icon} size="sm" tone="brand" />
      <Text variant="label">{label}</Text>
    </button>
  );
}
