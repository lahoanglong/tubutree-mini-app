import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ui } from '@/lib/guest-ui';
import { miniCard } from '@/components/loyalty/mini-surface';

/** Khung chuẩn của mỗi khối trong trang Vườn Xanh: tiêu đề h2 (icon Lucide, không emoji) + nội dung. */
export function GameCard({ title, icon: Icon, children }: { title: string; icon?: LucideIcon; children: ReactNode }) {
  return (
    <section className={`p-4 ${miniCard}`}>
      <h2 className={`mb-3 flex items-center gap-2 ${ui.sectionTitle}`}>
        {Icon && <Icon className="h-5 w-5 flex-none text-forest-600" aria-hidden="true" />}
        {title}
      </h2>
      {children}
    </section>
  );
}
