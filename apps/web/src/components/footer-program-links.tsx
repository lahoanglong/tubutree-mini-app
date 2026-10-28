'use client';

import Link from 'next/link';
import { canUseAcademy } from '@tubutree/app-core/academy-access';
import { useAuth } from '@/lib/auth-context';
import { isWebRouteReady } from '@/lib/route-map';
import { useWasteVisible } from '@/lib/use-waste-visible';

const LINK =
  'inline-flex min-h-11 items-center gap-2 text-sm font-medium text-forest-700 transition-colors hover:text-forest-800 hover:underline';

const PROGRAM_LINKS = [
  { to: '/vuon-xanh', label: 'Vườn Xanh' },
  { to: '/doi-rac', label: 'Đổi rác lấy quà' },
  { to: '/kho-qua', label: 'Kho quà' },
  { to: '/ctv', label: 'Cộng tác viên' },
  { to: '/dai-ly', label: 'Đại lý' },
  { to: '/hoc-vien', label: 'Học viện' },
];

/** Cột "Chương trình" của chân trang máy tính: Đổi rác theo cờ, Học viện chỉ cho CTV, đại lý, nhân viên (khách thường chỉ gặp cổng chặn). */
export function FooterProgramLinks() {
  const wasteVisible = useWasteVisible();
  const role = useAuth().user?.role;
  const ready = PROGRAM_LINKS.filter(
    (l) => isWebRouteReady(l.to) && (l.to !== '/doi-rac' || wasteVisible) && (l.to !== '/hoc-vien' || canUseAcademy(role)),
  );
  if (ready.length === 0) return null;
  return (
    <nav aria-label="Chương trình">
      <h2 className="text-sm font-semibold text-stone-900">Chương trình</h2>
      <ul className="mt-1">
        {ready.map((l) => (
          <li key={l.to}>
            <Link href={l.to} className={LINK}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
