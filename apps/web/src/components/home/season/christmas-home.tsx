'use client';

import '@tubutree/design-tokens/src/seasonal-christmas.css';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { countdownClock } from '@tubutree/app-core/commerce/countdown';
import { checkInQuery } from '@tubutree/app-core/queries/loyalty';
import { adventTileClock, adventView, msUntilNextVnDay, vnDayKeyOf, type AdventView } from '@tubutree/app-core/seasonal/advent';
import { BURST_FLAKES, GIFT_ART, GIFT_VIEWBOX, ICON_VIEWBOX, SNOWFLAKES, TREE_ART, TREE_VIEWBOX, XMAS_ICONS, type Flake } from '@tubutree/app-core/seasonal/christmas-art';
import { christmasCopy as c } from '@tubutree/app-core/seasonal/christmas-copy';
import { adventLeadLine, christmasHeroView, giftPreview, readSnowOff, settleOpening, SHAKE_MS, shouldClaim, type GiftPhase, writeSnowOff } from '@tubutree/app-core/seasonal/christmas-hero';
import { serverNow } from '@tubutree/app-core/server-clock';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { browserStorage } from '@/lib/recently-viewed';
import { loginHref } from '@/lib/return-to';
import { useCheckIn } from '@/lib/use-check-in';

/**
 * Noel Xanh trên Trang chủ web, bản web của `apps/miniapp/src/components/season/christmas-home.tsx` (cùng tên thành phần, cùng props, cùng lớp CSS
 * của design-tokens): thẻ cây thông rung quà kèm lịch quà 12 ngày, lớp tuyết toàn màn, dây đèn ở mép dưới header điện thoại. Chunk riêng, chỉ tải
 * khi `theme.seasonal` là "christmas" (home-season-slot.tsx, `next/dynamic` không dựng ở server).
 */
export default function ChristmasHome() {
  const reduced = useReducedMotion();
  const [snowOn, setSnowOn] = useState(() => !readSnowOff(browserStorage()));
  const toggleSnow = () => {
    const next = !snowOn;
    setSnowOn(next);
    writeSnowOff(browserStorage(), !next);
  };
  return (
    <>
      <ChristmasHomeHero snowOn={snowOn} onToggleSnow={reduced ? undefined : toggleSnow} />
      {snowOn && !reduced && <SnowfallLayer />}
      <FairyLightGarland />
    </>
  );
}

/** Thẻ "Cây Thông Tubu Tree Rung Quà": chạm cây hay nút → cây rung, tuyết rơi quanh cây → hộp quà rơi → "Mở quà" = điểm danh ngày (một lần mỗi ngày). */
export function ChristmasHomeHero({ snowOn, onToggleSnow }: { snowOn: boolean; onToggleSnow?: () => void }) {
  const authPhase = useAuthPhase();
  const authed = authPhase === 'authenticated';
  const restoring = authPhase === 'loading';
  const { status, statusQ, pending, checkIn, message } = useCheckIn(authed);
  const router = useRouter();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<GiftPhase>('idle');
  const [gift, setGift] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const [wiggle, setWiggle] = useState(false);
  const [dropAnim, setDropAnim] = useState(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const claimedToday = authed && status?.checkedInToday === true;
  const now = useNow(authed && (claimedToday || phase === 'opened'));
  const advent = adventView({ nowMs: now, checkInDays: authed ? status?.checkInDays : null, claimedToday });
  const lead = adventLeadLine({ phase: advent.phase, daysUntilStart: advent.daysUntilStart, firstLabel: advent.tiles[0]!.dateLabel });
  const view = christmasHeroView({ authed, status, statusFailed: authed && statusQ.isError && !status, phase, gift, advent: lead });
  // Web không có thanh thông báo nổi: mở quà lỗi hay chỉ nhận một phần thì câu của máy chủ thay dòng phụ ngay trên nút "Mở quà".
  const line = message?.error && phase === 'dropped' ? message.text : view.line;

  // Qua 00:00 giờ VN: quà ngày mới, cây về trạng thái đầu và trạng thái điểm danh tải lại.
  const dayKey = vnDayKeyOf(now);
  const seenDay = useRef(dayKey);
  useEffect(() => {
    if (seenDay.current === dayKey) return;
    seenDay.current = dayKey;
    setPhase('idle');
    setGift(null);
    setDropAnim(false);
    void qc.invalidateQueries({ queryKey: checkInQuery(coreHttp).queryKey });
  }, [dayKey, qc]);

  // Phiên vừa khôi phục xong (hay đăng nhập ở thẻ khác) lúc hộp quà đang nằm chờ: giữ hộp, chỉ còn bấm "Mở quà". Đăng xuất: về đầu.
  const seenAuthed = useRef(authed);
  useEffect(() => {
    if (seenAuthed.current === authed) return;
    seenAuthed.current = authed;
    setGift(null);
    setPhase((p) => (authed && (p === 'opened' || p === 'dropped') ? 'dropped' : 'idle'));
  }, [authed]);

  // Máy khác (hay tab khác) đã nhận quà hôm nay trong lúc hộp đang nằm chờ: thẻ chuyển sang "đã nhận".
  useEffect(() => {
    if (claimedToday && phase === 'dropped') setPhase('idle');
    if (claimedToday && phase === 'opening' && !pending) setPhase('opened');
  }, [claimedToday, phase, pending]);

  const shake = () => {
    setBurst((n) => n + 1);
    if (phase === 'idle' && !claimedToday) {
      setPhase('shaking');
      later(() => {
        setDropAnim(true);
        setPhase((p) => (p === 'shaking' ? 'dropped' : p));
      }, SHAKE_MS);
    } else if (!wiggle && phase !== 'shaking') {
      setWiggle(true);
      later(() => setWiggle(false), SHAKE_MS);
    }
  };

  const open = () => {
    if (!authed) {
      if (!restoring) setPhase('opened');
      return;
    }
    if (!shouldClaim({ authed, status, phase })) return;
    setGift(giftPreview(status));
    setPhase('opening');
    // Máy chủ trả lời sau 00:00 giờ VN: "opened" đổi nhịp đồng hồ thẻ (useNow đọc lại giờ ngay), hiệu ứng sang ngày đưa thẻ về đầu.
    checkIn((ok) => setPhase(settleOpening({ pending: false, claimedToday: ok, failed: !ok }) ?? 'dropped'));
  };

  // Phiên đang khôi phục: "Mở quà" chưa biết là khách hay thành viên nên nút báo bận thay vì bấm không phản hồi.
  const ctaBusy = !!view.cta?.busy || (restoring && view.cta?.action === 'open');

  const onCta = () => {
    const cta = view.cta;
    if (!cta || ctaBusy) return;
    if (cta.action === 'shake') shake();
    else if (cta.action === 'open') open();
    else router.push(loginHref('/'));
  };

  return (
    <section aria-label={c.heroLabel} className="tubu-xmas-hero" data-season="christmas" data-testid="christmas-hero" data-phase={phase}>
      <div className="tubu-xmas-top">
        {/* Hình cây chạm được cho vui tay; nút chữ bên cạnh là lối duy nhất cho trình đọc màn hình (cùng một việc, không đọc hai lần). */}
        <button type="button" className="tubu-xmas-tree-btn" aria-hidden="true" tabIndex={-1} onClick={shake} data-testid="christmas-tree">
          <TreeArt shaking={phase === 'shaking' || wiggle} />
          {view.gift !== 'none' && <GiftArt open={view.gift === 'open'} dropped={dropAnim} />}
        </button>
        <div className="tubu-xmas-body">
          <p className="tubu-xmas-title">{view.title}</p>
          <p className="tubu-xmas-line" role="status">
            {line}
          </p>
          {view.cta ? (
            <button type="button" className="tubu-xmas-cta" aria-busy={ctaBusy || undefined} onClick={onCta} data-testid="christmas-cta">
              {view.cta.label}
            </button>
          ) : (
            view.nextClock && (
              <p className="tubu-xmas-line">
                <span className="tubu-xmas-clock">{c.nextGift(countdownClock(msUntilNextVnDay(now)))}</span>
              </p>
            )
          )}
        </div>
        {onToggleSnow && (
          <button type="button" className="tubu-xmas-snow-toggle" aria-label={c.snow} aria-pressed={snowOn} onClick={onToggleSnow} data-testid="christmas-snow-toggle">
            <span>
              <XmasIcon d={XMAS_ICONS.snowflake} />
            </span>
          </button>
        )}
      </div>
      <AdventGreenStrip view={advent} clock={adventTileClock(advent.msToNextUnlock)} />
      {burst > 0 && <SnowBurst key={burst} />}
    </section>
  );
}

/** Lịch quà 12 ngày (14/12 → 25/12): ô đã mở xanh có dấu tích, ô hôm nay vàng nhấp nháy, ô chưa tới mờ có ổ khoá, ô kế tiếp đếm giờ. */
export function AdventGreenStrip({ view, clock }: { view: AdventView; clock: string }) {
  const listRef = useRef<HTMLOListElement>(null);
  const focus = view.todayIndex >= 0 ? view.todayIndex : view.nextIndex >= 0 ? view.nextIndex : view.tiles.length - 1;
  useEffect(() => {
    const ol = listRef.current;
    const li = ol?.children[focus] as HTMLElement | undefined;
    if (ol && li) ol.scrollLeft = Math.max(0, li.offsetLeft - ol.offsetLeft - (ol.clientWidth - li.offsetWidth) / 2);
  }, [focus]);
  return (
    <ol ref={listRef} className="tubu-xmas-advent" aria-label={c.adventLabel(view.claimed, view.tiles.length)} data-testid="advent-strip">
      {view.tiles.map((t) => (
        <li key={t.dateKey}>
          <div className="tubu-xmas-tile" data-state={t.state} data-today={t.isToday || undefined} aria-hidden="true">
            <span>{t.dateLabel.split('/')[0]}</span>
            {t.state === 'claimed' ? (
              <XmasIcon d={XMAS_ICONS.check} />
            ) : t.state === 'open' ? (
              <GiftArt open={false} dropped={false} mini />
            ) : t.state === 'locked' ? (
              t.isNext && clock ? (
                <span className="tubu-xmas-tile-sub">{clock}</span>
              ) : (
                <XmasIcon d={XMAS_ICONS.lock} />
              )
            ) : null}
          </div>
          <span className="sr-only">{c.tileAria(t.day, t.dateLabel, t.state)}</span>
        </li>
      ))}
    </ol>
  );
}

function TreeArt({ shaking }: { shaking: boolean }) {
  return (
    <svg className={shaking ? 'tubu-xmas-tree is-shaking' : 'tubu-xmas-tree'} viewBox={TREE_VIEWBOX} aria-hidden="true" focusable="false">
      <path className="tubu-xmas-trunk" d={TREE_ART.trunk} />
      {[2, 1, 0].map((i) => (
        <g key={i}>
          <path className={`tubu-xmas-tier-${i + 1}`} d={TREE_ART.tiers[i]} />
          <path className="tubu-xmas-snowline" d={TREE_ART.snow[i]} />
        </g>
      ))}
      {TREE_ART.berries.map(([x, y]) => (
        <circle key={`b${x}-${y}`} className="tubu-xmas-berry" cx={x} cy={y} r={2.4} />
      ))}
      {TREE_ART.lights.map(([x, y], i) => (
        <circle key={`l${x}-${y}`} className="tubu-xmas-light" cx={x} cy={y} r={1.8} style={{ '--i': i } as CSSProperties} />
      ))}
      <path className="tubu-xmas-star" d={TREE_ART.star} />
      <path className="tubu-xmas-pot-rim" d={TREE_ART.potRim} />
      <path className="tubu-xmas-pot" d={TREE_ART.pot} />
      <path className="tubu-xmas-leaf" d={TREE_ART.leaf} />
    </svg>
  );
}

function GiftArt({ open, dropped, mini = false }: { open: boolean; dropped: boolean; mini?: boolean }) {
  const cls = mini ? 'tubu-xmas-icon tubu-xmas-gift-mini' : `tubu-xmas-gift${dropped ? ' is-dropped' : ''}${open ? ' is-open' : ''}`;
  return (
    <svg className={cls} viewBox={GIFT_VIEWBOX} aria-hidden="true" focusable="false" data-testid={mini ? undefined : 'christmas-gift'}>
      <path className="tubu-xmas-gift-body" d={GIFT_ART.body} />
      <path className="tubu-xmas-gift-ribbon" d={GIFT_ART.ribbonBody} />
      <g className="tubu-xmas-gift-lid-group">
        <path className="tubu-xmas-gift-lid" d={GIFT_ART.lid} />
        <path className="tubu-xmas-gift-ribbon" d={GIFT_ART.ribbonLid} />
        <path className="tubu-xmas-gift-bow" d={GIFT_ART.bow} />
      </g>
    </svg>
  );
}

function XmasIcon({ d }: { d: string }) {
  return (
    <svg className="tubu-xmas-icon" viewBox={ICON_VIEWBOX} aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

const flakeVars = (f: Flake): CSSProperties => ({ '--x': f.x, '--s': f.size, '--d': f.dur, '--delay': f.delay, '--drift': f.drift, '--o': f.opacity }) as CSSProperties;

function SnowBurst() {
  return (
    <div className="tubu-xmas-burst" aria-hidden="true" data-testid="christmas-burst">
      {BURST_FLAKES.map((f, i) => (
        <span key={i} className={f.needle ? 'tubu-xmas-burst-flake is-needle' : 'tubu-xmas-burst-flake'} style={flakeVars(f)} />
      ))}
    </div>
  );
}

/** Lớp tuyết toàn màn (gắn vào body, không chặn chạm): tạm dừng khi tab ẩn; không gắn khi khách tắt ❄️ hay máy bật giảm chuyển động. */
export function SnowfallLayer() {
  const hidden = usePageHidden();
  return createPortal(
    <div className={hidden ? 'tubu-xmas-snow is-paused' : 'tubu-xmas-snow'} data-season="christmas" aria-hidden="true" data-testid="christmas-snow">
      {SNOWFLAKES.map((f, i) => (
        <span key={i} className={f.needle ? 'tubu-xmas-flake is-needle' : 'tubu-xmas-flake'} style={flakeVars(f)} />
      ))}
    </div>,
    document.body,
  );
}

/**
 * Dây đèn vàng ở mép dưới header Trang chủ khổ điện thoại: gắn vào vỏ khối header (đang dính), nằm đè 6px lên khối dưới, không thêm chiều cao nên
 * không xê dịch trang. Từ md header Trang chủ ẩn (thanh đầu website thay), dây đèn ẩn theo (`.is-phone-only`).
 */
export function FairyLightGarland() {
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => setHost(document.querySelector('[data-home-block="search"]')), []);
  return host ? createPortal(<div className="tubu-xmas-garland is-phone-only" data-season="christmas" aria-hidden="true" data-testid="christmas-garland" />, host) : null;
}

function useNow(everySecond: boolean): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    setNow(serverNow());
    const id = window.setInterval(() => setNow(serverNow()), everySecond ? 1_000 : 30_000);
    return () => window.clearInterval(id);
  }, [everySecond]);
  return now;
}

function usePageHidden(): boolean {
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return hidden;
}

const REDUCED = '(prefers-reduced-motion: reduce)';

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(REDUCED).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(REDUCED);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}
