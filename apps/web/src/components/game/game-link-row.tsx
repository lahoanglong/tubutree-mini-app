import Link from 'next/link';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ui } from '@/lib/guest-ui';

export function GameLinkRow({ icon: Icon, title, hint, badge, href }: { icon: LucideIcon; title: string; hint: string; badge?: string; href: string }) {
  return (
    <Link href={href} className={`flex min-h-11 items-center gap-3 px-4 py-2 hover:bg-stone-50 ${ui.card}`}>
      <span aria-hidden="true" className="grid h-9 w-9 flex-none place-items-center rounded-control bg-stone-50">
        <Icon className="h-5 w-5 text-forest-600" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-stone-900">
          {title}
          {badge && (
            <Badge tone="brand" size="sm">
              {badge}
            </Badge>
          )}
        </span>
        <span className="block text-xs text-stone-600">{hint}</span>
      </span>
      <ChevronRight className="h-4 w-4 flex-none text-stone-500" aria-hidden="true" />
    </Link>
  );
}
