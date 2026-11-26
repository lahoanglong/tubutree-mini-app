'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import type { MiniappAutoOpenResult, MiniappSmartbarAction } from '@tubutree/shared-types';
import { Button } from '@/components/mini/button';
import { IconButton } from '@/components/mini/icon-button';
import { routeTemplate, trackOncePerSession } from '@/lib/analytics';
import { writeWebCookie } from '@/lib/client-api';
import {
  AUTO_OPEN_COOKIE_MAX_AGE_S,
  AUTO_OPEN_DELAY_MS,
  MINI_APP_AUTO_OPEN_COPY as COPY,
  MINI_AUTO_COOKIE,
  MOBILE_MEDIA_QUERY,
  STAY_LINK_HIDE_MS,
  STAY_WEB_COOKIE,
  SUPPRESSED_CHECK_MS,
  decideMiniAppAutoOpen,
  hasCookie,
  hasStayWebParam,
  isExcludedPath,
  miniAppDeepLink,
  searchWithoutStay,
} from '@/lib/mini-app-auto-open';
import { useShellPathname } from '@/lib/shell-pathname';
import { SITE_URL } from '@/lib/site';
import { usePublicConfig } from '@/lib/use-public-config';

type Phase = 'idle' | 'opening' | 'banner' | 'done';

const siteHost = (() => {
  try {
    return new URL(SITE_URL).hostname;
  } catch {
    return null;
  }
})();

function trackAutoOpen(result: MiniappAutoOpenResult, pathname: string) {
  trackOncePerSession(`miniapp_auto_open:${result}`, 'miniapp_auto_open', { result, path: routeTemplate(pathname) });
}

function trackSmartbar(action: MiniappSmartbarAction, pathname: string) {
  trackOncePerSession(`miniapp_smartbar:${action}`, 'miniapp_smartbar_click', { action, path: routeTemplate(pathname) });
}

/**
 * Tự mở Zalo Mini App trên web điện thoại (W42, cờ `app.mobile_miniapp_redirect_enabled`). Tải lười chỉ khi khung nhìn là điện thoại (gác ở
 * `app/layout-shell.tsx`), nên HTML máy chủ và JS tải đầu của trang không đổi; cờ chưa được server xác nhận bật thì không làm gì.
 */
export function MiniAppAutoOpen() {
  const cfg = usePublicConfig();
  return cfg.isLoaded && cfg.mobileMiniappRedirectEnabled === true ? <AutoOpenRunner /> : null;
}

/**
 * Quyết định một lần lúc cờ vừa xác nhận bật ở trang đầu (luật ở `lib/mini-app-auto-open.ts`):
 * 1. `?stay=web`: ghi `tubu_stay_web` 24 giờ, xoá tham số khỏi thanh địa chỉ, không mở, không dải mời.
 * 2. Đủ điều kiện: ghi `tubu_mini_auto` 24 giờ rồi đọc lại; không ghi được thì chỉ hiện dải mời. Ghi được thì lớp phủ "Đang mở…" khoảng 1,2 giây
 *    với lối "Ở lại bản Web" (chữ nhỏ màu phụ, tự mờ rồi ẩn sau ~4,5 giây), hết giờ thì `location.assign(link Mini App)`.
 * 3. Trang vẫn hiện tới giây 4,5 (hệ điều hành không mở app), hoặc khách quay lại từ Zalo: đóng lớp phủ, hiện dải mời. Lối "Ở lại bản Web" bấm
 *    được suốt lúc lớp phủ còn, kể cả sau lượt chuyển (khách đang ở hộp hỏi mở app).
 * 4. Dải mời nằm trong luồng ở đầu nội dung (dưới thanh đầu trang, không nổi đè danh sách): "Mở" là cử chỉ thật của khách nên iOS mở được app;
 *    × ẩn 24 giờ (cùng cookie "ở lại bản Web"). Trang bị loại (thanh toán, giỏ, đăng nhập...) không có dải.
 */
function AutoOpenRunner() {
  const pathname = useShellPathname();
  const [phase, setPhase] = useState<Phase>('idle');
  const [stayHidden, setStayHidden] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const decided = useRef(false);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  const clearTimers = () => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  };

  useEffect(() => {
    if (decided.current) return;
    decided.current = true;
    const { search, hash } = window.location;
    if (hasStayWebParam(search)) {
      writeWebCookie(STAY_WEB_COOKIE, '1', AUTO_OPEN_COOKIE_MAX_AGE_S);
      try {
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${searchWithoutStay(search)}${hash}`);
      } catch {
        /* trình duyệt chặn đổi lịch sử: tham số còn trên thanh địa chỉ, cookie vẫn có hiệu lực */
      }
      setPhase('done');
      return;
    }
    const decision = decideMiniAppAutoOpen({
      flagOn: true,
      hostname: window.location.hostname,
      siteHost,
      userAgent: navigator.userAgent,
      webdriver: navigator.webdriver === true,
      narrowViewport: typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_MEDIA_QUERY).matches,
      pathname,
      search,
      cookies: document.cookie,
    });
    if (decision.banner) {
      setPhase('banner');
      return;
    }
    if (!decision.autoOpen) {
      setPhase('done');
      return;
    }
    writeWebCookie(MINI_AUTO_COOKIE, '1', AUTO_OPEN_COOKIE_MAX_AGE_S);
    if (!hasCookie(document.cookie, MINI_AUTO_COOKIE)) {
      trackAutoOpen('blocked_cookie', pathname);
      setPhase('banner');
      return;
    }
    const link = miniAppDeepLink(pathname, search);
    let wentHidden = false;
    const toBanner = () => {
      clearTimers();
      setPhase((p) => (p === 'opening' ? 'banner' : p));
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') wentHidden = true;
      else if (wentHidden) toBanner();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) toBanner();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    setPhase('opening');
    timers.current.push(setTimeout(() => setStayHidden(true), STAY_LINK_HIDE_MS));
    timers.current.push(
      setTimeout(() => {
        trackAutoOpen('navigated', pathRef.current);
        timers.current.push(
          setTimeout(() => {
            if (wentHidden || document.visibilityState !== 'visible') return;
            trackAutoOpen('suppressed', pathRef.current);
            toBanner();
          }, SUPPRESSED_CHECK_MS),
        );
        window.location.assign(link);
      }, AUTO_OPEN_DELAY_MS),
    );
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      clearTimers();
      // React StrictMode (dev) gỡ rồi chạy lại hiệu ứng: cho lượt sau quyết định lại (cookie tự mở đã ghi nên lượt đó ra dải mời, không kẹt lớp phủ).
      decided.current = false;
      setPhase('idle');
    };
    // Quyết định một lần ở trang đầu; đổi trang sau đó chỉ ẩn/hiện dải mời theo đường dẫn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stayWeb = () => {
    clearTimers();
    writeWebCookie(STAY_WEB_COOKIE, '1', AUTO_OPEN_COOKIE_MAX_AGE_S);
    trackAutoOpen('stayed', pathname);
    setPhase('done');
  };

  if (phase === 'opening') {
    return (
      <div className="tubu-miniapp-opening" data-testid="miniapp-opening">
        <div className="tubu-miniapp-opening__card">
          <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-forest-600 motion-reduce:animate-none" />
          <p role="status" aria-live="polite" className="tubu-miniapp-opening__title">
            {COPY.opening}
          </p>
          <button type="button" className="tubu-miniapp-stay" data-hidden={stayHidden ? 'true' : undefined} aria-hidden={stayHidden || undefined} tabIndex={stayHidden ? -1 : 0} onClick={stayWeb}>
            {COPY.stayWeb}
          </button>
        </div>
      </div>
    );
  }

  if (phase !== 'banner' || isExcludedPath(pathname)) return null;
  return (
    <section aria-label={COPY.bannerTitle} className="tubu-miniapp-bar" data-testid="miniapp-smartbar">
      <div className="tubu-miniapp-bar__copy">
        <span className="tubu-miniapp-bar__title">{COPY.bannerTitle}</span>
        <span className="tubu-miniapp-bar__sub">{COPY.bannerSub}</span>
      </div>
      <Button
        onPress={() => {
          trackSmartbar('open', pathname);
          window.location.assign(miniAppDeepLink(pathname, window.location.search));
        }}
      >
        {COPY.bannerOpen}
      </Button>
      <IconButton
        icon={X}
        label={COPY.bannerClose}
        onPress={() => {
          writeWebCookie(STAY_WEB_COOKIE, '1', AUTO_OPEN_COOKIE_MAX_AGE_S);
          trackSmartbar('dismiss', pathname);
          setPhase('done');
        }}
      />
    </section>
  );
}
