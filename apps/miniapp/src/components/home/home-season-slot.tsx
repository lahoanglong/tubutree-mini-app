import { Component, lazy, Suspense, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { CHRISTMAS_HERO_HEIGHT, normalizeSeasonalTheme, readSeasonHint, seasonHasHomeTheme, writeSeasonHint } from '@tubutree/app-core/seasonal/seasonal-theme';
import { usePublicConfig } from '../../hooks/use-public-config';
import { browserStorage } from '../../utils/recently-viewed';

const ChristmasHome = lazy(() => import('../season/christmas-home'));

/**
 * Chỗ gắn khối mùa lễ của Trang chủ (ngay dưới dải ngữ cảnh). Nằm trong chunk các khối dưới màn đầu nên gói đầu chỉ gánh một dòng gọi; mã của mùa
 * (Noel: cây thông, lịch quà, tuyết, dây đèn) ở chunk riêng chỉ tải khi `theme.seasonal` bật mùa đó. Mùa "none"/"tet" (chưa có giao diện): không vẽ gì,
 * không tải chunk nào. Cấu hình chưa về thì theo mùa của lần mở trước (giữ đúng chiều cao thẻ, trang không nhảy khi thẻ hiện).
 */
export function HomeSeasonSlot() {
  const cfg = usePublicConfig();
  const [hint] = useState(() => readSeasonHint(browserStorage()));
  const theme = cfg.isLoaded ? normalizeSeasonalTheme(cfg.seasonalTheme) : hint;
  useEffect(() => {
    if (cfg.isLoaded) writeSeasonHint(browserStorage(), theme);
  }, [cfg.isLoaded, theme]);
  if (!seasonHasHomeTheme(theme)) return null;
  return (
    <div data-home-block="season" style={SHELL}>
      <SeasonBoundary>
        <Suspense fallback={<div aria-hidden="true" data-testid="home-season-wait" style={WAIT} />}>
          <ChristmasHome />
        </Suspense>
      </SeasonBoundary>
    </div>
  );
}

// Lề trên như mọi khối Trang chủ (vỏ khối đặt lề, khối con không tự đặt); lề ngang theo lề trang.
const SHELL: CSSProperties = { marginTop: 'var(--space-block)', padding: '0 var(--space-inset-page)' };
const WAIT: CSSProperties = { height: CHRISTMAS_HERO_HEIGHT };

/** Chunk mùa lễ hỏng (mạng rớt): bỏ khối, Trang chủ vẫn dùng được; không hiện màn lỗi cho một khối trang trí. */
class SeasonBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}
