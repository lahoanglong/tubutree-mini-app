import { lazy, Suspense } from 'react';
import { useLocation } from 'zmp-ui';
import { normalizeSeasonalTheme, showsSiteSnow } from '@tubutree/app-core/seasonal/seasonal-theme';
import { usePublicConfig } from '../../hooks/use-public-config';
import { showsBottomNav } from '../nav-config';
import { SilentBoundary } from '../route-shell';

const SiteSnow = lazy(() => import('./snowfall'));

/**
 * Cổng tuyết Noel toàn app (vỏ app, cạnh thanh đáy): gói đầu chỉ gánh phần đọc đường dẫn và mùa; lớp tuyết, nút ❄️ và CSS mùa ở chunk `snowfall`,
 * chỉ tải khi `theme.seasonal` là Noel và trang nằm trong `showsSiteSnow`. Chunk hỏng (mạng rớt) thì bỏ tuyết, trang vẫn dùng được.
 */
export function SiteSnowGate() {
  const { pathname } = useLocation();
  return showsSiteSnow('miniapp', pathname) ? <SeasonSnow overNav={showsBottomNav(pathname)} /> : null;
}

function SeasonSnow({ overNav }: { overNav: boolean }) {
  const cfg = usePublicConfig();
  if (normalizeSeasonalTheme(cfg.seasonalTheme) !== 'christmas') return null;
  return (
    <SilentBoundary>
      <Suspense fallback={null}>
        <SiteSnow overNav={overNav} />
      </Suspense>
    </SilentBoundary>
  );
}
