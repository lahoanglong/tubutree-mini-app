'use client';

import { useRouter } from 'next/navigation';
import { BookOpen, Store, Users, type LucideIcon } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { BottomSheet, Icon, ListRow } from '@/components/mini';

const ITEMS: { Icon: LucideIcon; label: string; hint: string; to: string }[] = [
  { Icon: Users, ...homeCopy.earn.affiliate, to: '/ctv' },
  { Icon: BookOpen, ...homeCopy.earn.academy, to: '/hoc-vien' },
  { Icon: Store, ...homeCopy.earn.dealer, to: '/dai-ly' },
];

/** "Kiếm tiền cùng Tubu": gom Cộng tác viên, Học viện, Đại lý vào một lối tắt để không chen vào hành trình mua của khách thường. */
export function EarnSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
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
              onClose();
              router.push(it.to);
            }}
            style={{ borderTop: i === 0 ? 'none' : '1px solid var(--color-border-subtle)' }}
          />
        ))}
      </div>
    </BottomSheet>
  );
}
