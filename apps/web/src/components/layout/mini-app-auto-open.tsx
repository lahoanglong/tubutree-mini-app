'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { X } from 'lucide-react';
import type { MiniappAutoOpenResult, MiniappSmartbarAction } from '@tubutree/shared-types';
import tubuLogoMark from '@/assets/tubu-logo-mark.png';
import { routeTemplate, trackOncePerSession } from '@/lib/analytics';
import { writeWebCookie } from '@/lib/client-api';
import {
  AUTO_OPEN_COOKIE_MAX_AGE_S,
  AUTO_OPEN_DELAY_MS,
  MINI_APP_AUTO_OPEN_COPY as COPY,
  MINI_APP_BAR_ATTR,
  MINI_AUTO_COOKIE,
  MOBILE_MEDIA_QUERY,
  OVERLAY_FADE_MS,
  STAY_WEB_COOKIE,
  SUPPRESSED_CHECK_MS,
  decideMiniAppAutoOpen,
  hasCookie,
  hasStayWebParam,
  isSmartBarHiddenPath,
  miniAppDeepLink,
  searchWithoutStay,
} from '@/lib/mini-app-auto-open';
import { useShellPathname } from '@/lib/shell-pathname';
import { SITE_URL } from '@/lib/site';
import { usePublicConfig } from '@/lib/use-public-config';

/** `leaving`: lớp phủ đang mờ dần (không bấm được nữa), dải mời đã gắn bên dưới; hết `OVERLAY_FADE_MS` thì sang `banner`. */
type Phase = 'idle' | 'opening' | 'leaving' | 'banner' | 'done';

/**
 * Bật/gỡ chỗ giữ cho dải mời (`data-miniapp-bar` trên `<html>`, script ở `<head>` đặt trước khi vẽ khi đoán được). Gỡ khi biết chắc dải không
 * hiện; dải đang hiện thì giữ (chỗ giữ cao đúng bằng dải nên không xê dịch).
 */
export function setMiniAppBarSlot(reserved: boolean): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  if (reserved) html.setAttribute(MINI_APP_BAR_ATTR, '');
  else html.removeAttribute(MINI_APP_BAR_ATTR);
}

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  const on = cfg.isLoaded && cfg.mobileMiniappRedirectEnabled === true;
  // Cờ tắt (hoặc không tải được cấu hình): gỡ chỗ giữ mà script ở <head> đã đoán. Riêng cờ tắt thì xoá luôn cookie tự mở, để lần tải sau
  // không giữ chỗ cho một dải sẽ không hiện (mỗi lần giữ rồi gỡ là một lần xê dịch).
  const off = cfg.isLoaded ? cfg.mobileMiniappRedirectEnabled !== true : !cfg.isPending;
  useEffect(() => {
    if (!off) return;
    setMiniAppBarSlot(false);
    if (cfg.isLoaded && hasCookie(document.cookie, MINI_AUTO_COOKIE)) writeWebCookie(MINI_AUTO_COOKIE, null);
  }, [off, cfg.isLoaded]);
  return on ? <AutoOpenRunner /> : null;
}

/**
 * Quyết định một lần lúc cờ vừa xác nhận bật ở trang đầu (luật ở `lib/mini-app-auto-open.ts`):
 * 1. `?stay=web`: ghi `tubu_stay_web` 24 giờ, xoá tham số khỏi thanh địa chỉ, không mở, không dải mời.
 * 2. Đủ điều kiện: ghi `tubu_mini_auto` 24 giờ rồi đọc lại; không ghi được thì chỉ hiện dải mời. Ghi được thì lớp phủ "Đang mở…" khoảng 1,2 giây
 *    với lối "Ở lại web" (chữ nhỏ màu phụ), hết giờ thì `location.assign(link Mini App)`.
 * 3. Tới giây 4,5 (hệ điều hành không mở app, hoặc khách đang ở Zalo), hoặc khách quay lại từ Zalo: lớp phủ mờ dần 300ms (pha `leaving`, không
 *    bấm được nữa) trong khi dải mời đã gắn sẵn bên dưới, rồi chỉ còn dải. Giảm chuyển động thì bỏ bước mờ. Lối "Ở lại web" bấm được suốt lúc
 *    lớp phủ còn, kể cả sau lượt chuyển (khách đang ở hộp hỏi mở app).
 * 4. Dải mời nằm trong luồng ở đầu nội dung (dưới thanh đầu trang, không nổi đè danh sách): "Mở" là cử chỉ thật của khách nên iOS mở được app;
 *    × ẩn 24 giờ (cùng cookie "ở lại web"). Trang bị loại (thanh toán, giỏ, đăng nhập...) và trang sản phẩm không có dải.
 */
function AutoOpenRunner() {
  const pathname = useShellPathname();
  const [phase, setPhase] = useState<Phase>('idle');
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
      if (reducedMotion()) {
        setPhase((p) => (p === 'opening' ? 'banner' : p));
        return;
      }
      setPhase((p) => (p === 'opening' ? 'leaving' : p));
      timers.current.push(setTimeout(() => setPhase((p) => (p === 'leaving' ? 'banner' : p)), OVERLAY_FADE_MS));
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
    timers.current.push(
      setTimeout(() => {
        trackAutoOpen('navigated', pathRef.current);
        // Giây 4,5 (`STAY_LINK_HIDE_MS`): lớp phủ rời đi trong mọi trường hợp. Trang còn hiện thì ghi "bị chặn"; trang đang ẩn (khách ở Zalo) thì
        // dải mời chờ sẵn cho lúc khách quay lại.
        timers.current.push(
          setTimeout(() => {
            if (!wentHidden && document.visibilityState === 'visible') trackAutoOpen('suppressed', pathRef.current);
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

  const leaving = phase === 'leaving';
  const showBar = (phase === 'banner' || leaving) && !isSmartBarHiddenPath(pathname);
  // Chưa quyết (`idle`) thì giữ nguyên chỗ script ở <head> đã đoán; quyết xong thì chỗ giữ đi theo đúng việc dải có hiện hay không.
  // Trước khi vẽ: dải vừa gỡ (×, sang trang bị loại) thì ô sập cùng khung hình, không nháy một ô trống.
  useLayoutEffect(() => {
    if (phase !== 'idle') setMiniAppBarSlot(showBar);
  }, [phase, showBar]);

  const overlay =
    phase === 'opening' || leaving ? (
      <div className="tubu-miniapp-opening" data-testid="miniapp-opening" data-leaving={leaving ? '' : undefined} aria-hidden={leaving || undefined}>
        <div className="tubu-miniapp-opening__card">
          <AppIcon size="lg" />
          <p role="status" aria-live="polite" className="tubu-miniapp-opening__title">
            {COPY.opening}
          </p>
          <button type="button" className="tubu-miniapp-stay" tabIndex={leaving ? -1 : 0} disabled={leaving} onClick={stayWeb}>
            {COPY.stayWeb}
          </button>
        </div>
      </div>
    ) : null;

  if (!showBar) return overlay;
  return (
    <>
      {overlay}
      <SmartBar pathname={pathname} onDismiss={() => setPhase('done')} />
    </>
  );
}

/** Biểu tượng app (dấu logo Tubu trên ô vuông bo góc), như ô biểu tượng của Smart App Banner trên iOS. Chỉ trang trí: tên app nằm ở chữ bên cạnh. */
function AppIcon({ size }: { size: 'md' | 'lg' }) {
  return (
    <span aria-hidden="true" className="tubu-miniapp-icon" data-size={size}>
      {/* Ở đầu màn ngay khi hiện: tải ngay, không đợi lazy (ảnh 3 KB, chunk này vốn đã nạp lười chỉ ở điện thoại). */}
      <Image src={tubuLogoMark} alt="" width={16} height={24} loading="eager" className="tubu-miniapp-icon__mark" />
    </span>
  );
}

/**
 * Dải mời trong luồng ở đầu nội dung, bố cục Smart App Banner của iOS: × nhỏ màu phụ ở mép trái (ẩn 24 giờ, cùng cookie "ở lại web"), ô biểu
 * tượng app, tên app và dòng phụ, nút viên thuốc "Mở" ở mép phải ("Mở" là cử chỉ thật của khách nên iOS mở được app). Mọi nút có vùng chạm 44px.
 */
function SmartBar({ pathname, onDismiss }: { pathname: string; onDismiss: () => void }) {
  return (
    <section aria-label={COPY.bannerTitle} className="tubu-miniapp-bar" data-testid="miniapp-smartbar">
      <button
        type="button"
        aria-label={COPY.bannerClose}
        className="tubu-miniapp-bar__close tubu-press"
        onClick={() => {
          writeWebCookie(STAY_WEB_COOKIE, '1', AUTO_OPEN_COOKIE_MAX_AGE_S);
          trackSmartbar('dismiss', pathname);
          onDismiss();
        }}
      >
        <X aria-hidden="true" className="tubu-miniapp-bar__close-icon" />
      </button>
      <AppIcon size="md" />
      <div className="tubu-miniapp-bar__copy">
        <span className="tubu-miniapp-bar__title">{COPY.bannerTitle}</span>
        <span className="tubu-miniapp-bar__sub">{COPY.bannerSub}</span>
      </div>
      <button
        type="button"
        className="tubu-miniapp-bar__open tubu-press"
        onClick={() => {
          trackSmartbar('open', pathname);
          window.location.assign(miniAppDeepLink(pathname, window.location.search));
        }}
      >
        <span className="tubu-miniapp-bar__pill">{COPY.bannerOpen}</span>
      </button>
    </section>
  );
}
