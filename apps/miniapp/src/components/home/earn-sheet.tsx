import { useNavigate } from 'zmp-ui';
import { BookOpen, Store, Users, type LucideIcon } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { haptic } from '../../utils/haptic';
import { BottomSheet } from '../ui/bottom-sheet';
import { Icon } from '../ui/icon';
import { ListRow } from '../ui/list-row';

const ITEMS: { Icon: LucideIcon; label: string; hint: string; to: string }[] = [
  { Icon: Users, ...homeCopy.earn.affiliate, to: '/affiliate' },
  { Icon: BookOpen, ...homeCopy.earn.academy, to: '/academy' },
  { Icon: Store, ...homeCopy.earn.dealer, to: '/dealer' },
];

/** "Kiếm tiền cùng Tubu": gom Cộng tác viên, Học viện, Đại lý vào một lối tắt để không chen vào hành trình mua của khách thường. */
export function EarnSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <BottomSheet open={open} onClose={onClose} title={homeCopy.earn.title} description={homeCopy.earn.sheetBody}>
      <div style={{ padding: '0 16px 8px' }}>
        {ITEMS.map((it, i) => (
          <ListRow
            key={it.to}
            icon={<Icon icon={it.Icon} tone="brand" />}
            title={it.label}
            subtitle={it.hint}
            trailing="chevron"
            onPress={() => {
              haptic('light');
              onClose();
              navigate(it.to);
            }}
            style={{ borderTop: i === 0 ? 'none' : '1px solid var(--color-border-subtle)' }}
          />
        ))}
      </div>
    </BottomSheet>
  );
}
