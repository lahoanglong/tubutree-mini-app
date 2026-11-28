'use client';

import { useEffect, useState, type ComponentType } from 'react';
import { normalizeSeasonalTheme, showsSiteSnow } from '@tubutree/app-core/seasonal/seasonal-theme';
import { useShellPathname } from '@/lib/shell-pathname';
import { usePublicConfig } from '@/lib/use-public-config';
import { showsWebBottomNav } from '@/lib/web-nav';

type SiteSnowView = ComponentType<{ overNav: boolean }>;

/**
 * Cổng tuyết Noel toàn site (bản web của Mini `components/season/site-snow-gate.tsx`, gắn ở app/layout-shell.tsx): JS tải đầu chỉ gánh phần đọc
 * đường dẫn và mùa; lớp tuyết, nút ❄️ và CSS mùa ở chunk `snowfall`, chỉ tải khi trang nằm trong `showsSiteSnow` và `theme.seasonal` là Noel.
 * Tự `import()` trong hiệu ứng như `MiniAppAutoOpenGate` (không `next/dynamic`, xem chú thích ở layout-shell.tsx). Chunk hỏng thì bỏ tuyết.
 */
export function SiteSnowGate() {
  const pathname = useShellPathname();
  return showsSiteSnow('web', pathname) ? <SeasonSnow overNav={showsWebBottomNav(pathname)} /> : null;
}

function SeasonSnow({ overNav }: { overNav: boolean }) {
  const cfg = usePublicConfig();
  const on = normalizeSeasonalTheme(cfg.seasonalTheme) === 'christmas';
  const [View, setView] = useState<SiteSnowView | null>(null);
  useEffect(() => {
    if (!on || View) return;
    let alive = true;
    import('./snowfall')
      .then((m) => {
        if (alive) setView(() => m.default);
      })
      .catch(() => {
        // Mạng chập chờn: bỏ tuyết ở lượt này, trang vẫn dùng bình thường.
      });
    return () => {
      alive = false;
    };
  }, [on, View]);
  return on && View ? <View overNav={overNav} /> : null;
}
