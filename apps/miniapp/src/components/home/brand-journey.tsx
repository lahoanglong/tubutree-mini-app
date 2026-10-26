import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { ChevronRight, Map as MapIcon } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { fetchBrands } from '../../services/shop-api';
import { brandBrowsePath } from '../../utils/brands';
import { haptic } from '../../utils/haptic';
import { Chip } from '../ui/chip';
import { Icon } from '../ui/icon';
import { ScrollRow } from '../ui/scroll-row';
import { Heading, Text } from '../ui/text';

/**
 * "Hành trình nguyên liệu" giữa Trang chủ: thẻ mở bản đồ xuất xứ, kèm dải nhãn Việt (chạm mở trang nhãn). Nội dung riêng và đẹp
 * nhất của Tubu nên đứng giữa trang, không ở đáy. Chưa có danh sách nhãn thì vẫn có thẻ bản đồ.
 */
export function BrandJourney() {
  const navigate = useNavigate();
  // Nhãn chậm đổi (sync Pancake ~15 phút/lần) → cache 60s, ghi đè mặc định 10s.
  const brands = useQuery({ queryKey: ['brands'], queryFn: fetchBrands, staleTime: 60_000 });
  const list = brands.data ?? [];
  const go = (to: string) => {
    haptic('light');
    navigate(to);
  };
  return (
    <section aria-label={homeCopy.journey.title} style={{ padding: '8px 16px 8px' }}>
      <div style={{ background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-card)', padding: 12 }}>
        <button
          type="button"
          className="tubu-press"
          onClick={() => go('/brand-story')}
          style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 44, padding: 0, border: 'none', background: 'transparent', textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer' }}
        >
          <span aria-hidden style={{ width: 44, height: 44, borderRadius: 'var(--radius-control)', background: 'var(--color-bg-surface)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
            <Icon icon={MapIcon} tone="brand" />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <Heading variant="title-sm" as="h2">
              {homeCopy.journey.title}
            </Heading>
            <Text variant="caption" tone="secondary" as="div">
              {homeCopy.journey.body(list.length)}
            </Text>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flex: '0 0 auto' }}>
            <Text variant="label" tone="brand">
              {homeCopy.journey.cta}
            </Text>
            <Icon icon={ChevronRight} size="sm" tone="brand" />
          </span>
        </button>
        {list.length > 0 && (
          <ScrollRow label="Dải thương hiệu, vuốt ngang để xem thêm" style={{ gap: 8, padding: '8px 0 4px' }}>
            {list.map((b) => (
              <Chip key={b.brand} onPress={() => go(b.slug ? `/brand/${encodeURIComponent(b.slug)}` : brandBrowsePath(b.brand))}>
                {b.brand}
              </Chip>
            ))}
          </ScrollRow>
        )}
      </div>
    </section>
  );
}
