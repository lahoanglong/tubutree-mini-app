'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Pause, Play, X } from 'lucide-react';
import { arcadeWaterFor, type ArcadeGameId } from '@tubutree/app-core/arcade/arcade-config';
import type { ArcadeResult, ArcadeTheme, mountArcade } from '@tubutree/app-core/arcade/arcade-canvas';
import { endTip } from '@tubutree/app-core/arcade/arcade-tips';
import type { ArcadeCompleteResult } from '@tubutree/app-core/api/game';
import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useAuthPhase } from '@/lib/auth-phase';
import { loadErrorText } from '@/lib/error-text';
import { ui } from '@/lib/guest-ui';
import { loginHref } from '@/lib/return-to';
import { useModalA11y } from '@/lib/use-modal-a11y';
import { Badge, Button, Chip, Heading, IconButton, Skeleton, Text } from '@/components/mini';
import { SR_ONLY } from '@/components/mini/sr-only';
import { rememberPendingArcade } from './arcade-pending';
import { readGuestBest, writeGuestBest } from './arcade-storage';
import { useArcadeSave, type ArcadeSaveState } from './use-arcade-save';

type ArcadeControls = ReturnType<typeof mountArcade>;
type Phase = 'ready' | 'playing' | 'ended';
interface End {
  result: ArcadeResult;
  guestBest: number;
  guestNew: boolean;
}

/** Hậu tố khoá chữ `arcade.<k>.*` của từng game. */
export const ARCADE_COPY_KEY: Record<ArcadeGameId, 'dew' | 'rush'> = { dew_catcher: 'dew', refill_rush: 'rush' };

// Màu canvas đọc từ token ngữ nghĩa lúc mở (đổi chủ đề thì ván sau lấy màu mới); jsdom và trình duyệt cũ không trả giá trị thì dùng màu chữ của canvas.
const THEME_TOKENS: Record<keyof ArcadeTheme, string> = {
  bg: '--color-bg-subtle',
  surface: '--color-bg-surface',
  forest: '--color-text-brand',
  sage: '--color-story-tone-leaf',
  cream: '--color-track',
  ink: '--color-text-primary',
  accent: '--color-promo-solid-bg',
  danger: '--color-status-danger-fg',
};

function readTheme(el: Element): ArcadeTheme {
  const css = getComputedStyle(el);
  const value = (token: string) => css.getPropertyValue(token).trim() || 'currentColor';
  return Object.fromEntries(Object.entries(THEME_TOKENS).map(([name, token]) => [name, value(token)])) as ArcadeTheme;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const currentPath = () => `${window.location.pathname}${window.location.search}`;

// Khoá chữ theo lý do không thưởng; lý do máy chủ thêm sau mà bản này chưa biết thì không nói gì thay vì nói sai.
const REASON_COPY: Record<string, string> = {
  DAILY_CAP: 'arcade.result.capped',
  TOO_FAST: 'arcade.result.tooFast',
  DISABLED: 'arcade.result.disabled',
  NOT_REAL_USER: 'arcade.result.notReal',
  LOW_SCORE: 'arcade.result.lowScore',
};

/** Các dòng thưởng của ván đã lưu: ván được thưởng nêu Giọt nước, Điểm Xanh và số lượt (đúng số máy chủ trả, trần có thể hơn 3); hết lượt vẫn nêu số lượt; lý do khác chỉ nói lý do. */
export function rewardLines(d: ArcadeCompleteResult): string[] {
  const used = fillCopy('arcade.result.used', { n: d.used, m: d.cap });
  if (d.rewarded) {
    return [
      d.waterEarned > 0 ? fillCopy('arcade.result.water', { n: d.waterEarned }) : '',
      d.pointsEarned > 0 ? fillCopy('arcade.result.points', { n: d.pointsEarned }) : '',
      used,
      d.windowBonus ? fillCopy('arcade.result.window') : '',
    ].filter(Boolean);
  }
  const reasonKey = d.reason ? REASON_COPY[d.reason] : undefined;
  const reason = reasonKey ? fillCopy(reasonKey) : '';
  return [reason, d.reason === 'DAILY_CAP' ? used : ''].filter(Boolean);
}

interface Line {
  text: string;
  kind?: 'best' | 'error';
}

function summaryLines(end: End, authed: boolean, save: ArcadeSaveState): Line[] {
  const plain = (texts: string[]): Line[] => texts.map((text) => ({ text }));
  const lines: Line[] = [{ text: fillCopy('arcade.result.score', { n: end.result.score }) }];
  if (!authed) {
    if (end.guestNew) lines.push({ text: fillCopy('arcade.newBest'), kind: 'best' });
    lines.push(...plain([fillCopy('arcade.best', { n: end.guestBest }), fillCopy('arcade.guest.demo')]));
  } else if (save.status === 'done') {
    if (save.data.isNewBest) lines.push({ text: fillCopy('arcade.newBest'), kind: 'best' });
    lines.push(...plain([fillCopy('arcade.best', { n: save.data.bestScore }), ...rewardLines(save.data)]));
  } else if (save.status === 'error') {
    lines.push({ text: fillCopy(save.invalid ? 'arcade.result.invalid' : 'arcade.result.error'), kind: 'error' });
  }
  return lines;
}

export interface ArcadeGameOverlayProps {
  gameId: ArcadeGameId;
  onClose: () => void;
}

/**
 * Lớp phủ toàn màn của một mini game (không thêm route): điện thoại phủ kín màn như Mini App, từ md là hộp thoại giữa màn rộng `--dialog-w`.
 * Engine và bộ vẽ ở app-core (`mountArcade`), nạp bằng `import()` ở lần mở đầu để gói đầu của Vườn Xanh và Trang chủ không phồng.
 * Tab quay vòng trong lớp, Esc đóng, khoá cuộn nền và trả focus về nút mở (`useModalA11y`); tab ẩn thì ván tạm dừng.
 * Đã đăng nhập: cuối ván gửi `completeArcade` đúng một lần (`useArcadeSave`); khách chơi thử và giữ kỷ lục trên máy.
 */
export function ArcadeGameOverlay({ gameId, onClose }: ArcadeGameOverlayProps) {
  const k = ARCADE_COPY_KEY[gameId];
  const authed = useAuthPhase() === 'authenticated';
  const panelRef = useModalA11y<HTMLDivElement>(onClose);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const controls = useRef<ArcadeControls | null>(null);
  const [mounted, setMounted] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>('ready');
  const [paused, setPaused] = useState(false);
  const [end, setEnd] = useState<End | null>(null);
  const save = useArcadeSave();
  // Mỗi ván một số: `onEnd` bắn lại (hay bắn hai lần) trong cùng ván không ghi kỷ lục và không gửi máy chủ thêm.
  const runId = useRef(0);
  const endedRun = useRef(0);
  const phaseRef = useRef<Phase>('ready');
  const pausedRef = useRef(false);
  phaseRef.current = phase;
  pausedRef.current = paused;

  const handleEnd = useCallback(
    (result: ArcadeResult) => {
      if (endedRun.current === runId.current) return;
      endedRun.current = runId.current;
      const prev = authed ? 0 : readGuestBest(gameId);
      if (!authed) writeGuestBest(gameId, result.score);
      setEnd({ result, guestBest: Math.max(prev, result.score), guestNew: !authed && result.score > prev });
      setPhase('ended');
      setPaused(false);
      if (authed) save.begin(result);
    },
    [authed, gameId, save],
  );
  const endRef = useRef(handleEnd);
  endRef.current = handleEnd;

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    let cancelled = false;
    let ctl: ArcadeControls | null = null;
    let observer: ResizeObserver | null = null;
    const fit = () => {
      const r = stage.getBoundingClientRect();
      ctl?.resize(r.width, r.height, window.devicePixelRatio || 1);
    };
    import('@tubutree/app-core/arcade/arcade-canvas').then(
      ({ mountArcade: mount }) => {
        if (cancelled) return;
        ctl = mount({
          game: gameId,
          canvas,
          theme: readTheme(canvas),
          reducedMotion: prefersReducedMotion(),
          raf: (cb) => window.requestAnimationFrame(cb),
          caf: (id) => window.cancelAnimationFrame(id),
          now: () => performance.now(),
          onEnd: (r) => endRef.current(r),
        });
        controls.current = ctl;
        fit();
        if (typeof ResizeObserver === 'undefined') window.addEventListener('resize', fit);
        else {
          observer = new ResizeObserver(fit);
          observer.observe(stage);
        }
        setLoadError(null);
        setMounted(true);
      },
      (e: unknown) => {
        if (!cancelled) setLoadError(e ?? new Error('arcade'));
      },
    );
    return () => {
      cancelled = true;
      observer?.disconnect();
      window.removeEventListener('resize', fit);
      ctl?.destroy();
      controls.current = null;
      setMounted(false);
    };
  }, [gameId, attempt]);

  useEffect(() => {
    const onVisibility = () => {
      const ctl = controls.current;
      if (!ctl || phaseRef.current !== 'playing') return;
      if (document.hidden) ctl.pause();
      else if (!pausedRef.current) ctl.resume();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (phase === 'ended') resultRef.current?.focus();
  }, [phase]);

  const start = () => {
    const ctl = controls.current;
    if (!ctl) return;
    runId.current += 1;
    save.reset();
    setEnd(null);
    setPaused(false);
    setPhase('playing');
    ctl.start();
    canvasRef.current?.focus();
  };
  const togglePause = () => {
    const ctl = controls.current;
    if (!ctl) return;
    if (paused) ctl.resume();
    else ctl.pause();
    setPaused(!paused);
  };

  // Đăng nhập là rời trang: nhớ ván này để sảnh gửi nốt sau khi quay về (ván chờ tối đa 10 phút).
  const rememberRun = () => {
    if (end) rememberPendingArcade({ gameId: end.result.gameId, score: end.result.score, durationMs: end.result.durationMs });
  };

  const title = fillCopy(`arcade.${k}.title`);
  const lines = useMemo(() => (end ? summaryLines(end, authed, save.state) : []), [end, authed, save.state]);
  const tip = useMemo(() => (end ? endTip(gameId, end.result.stats) : null), [end, gameId]);
  if (typeof document === 'undefined') return null;

  const saving = authed && end !== null && (save.state.status === 'saving' || save.state.status === 'idle');
  const [scoreLine, ...restLines] = lines;
  return createPortal(
    <div data-testid="arcade-overlay" className="fixed inset-0 z-50 flex items-stretch justify-center md:items-center">
      <div data-sheet-backdrop aria-hidden="true" className="absolute inset-0 bg-sheet-scrim md:motion-safe:animate-dialog-fade" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="arcade-title"
        tabIndex={-1}
        className="relative flex h-full w-full flex-col overflow-hidden bg-[var(--color-bg-surface)] outline-none md:h-[85vh] md:max-h-[44rem] md:max-w-[var(--dialog-w)] md:rounded-sheet md:shadow-dialog md:motion-safe:animate-dialog-pop"
      >
        <div className="flex items-center justify-between gap-2 px-4 pt-[env(safe-area-inset-top,0px)]">
          <h2 id="arcade-title" className={`min-w-0 ${ui.blockTitle}`}>
            {title}
          </h2>
          <div className="flex flex-none items-center">
            {phase === 'playing' && <IconButton icon={paused ? Play : Pause} label={fillCopy(paused ? 'arcade.resume' : 'arcade.pause')} onPress={togglePause} />}
            <IconButton icon={X} label={fillCopy('arcade.close')} onPress={onClose} />
          </div>
        </div>

        <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden">
          <canvas
            ref={canvasRef}
            data-testid="arcade-canvas"
            role="application"
            aria-label={fillCopy(`arcade.${k}.aria`)}
            tabIndex={0}
            className="absolute inset-0 h-full w-full touch-none outline-none focus-visible:[box-shadow:inset_0_0_0_0.125rem_var(--color-border-focus)]"
          />

          {phase === 'ready' && (
            <div data-testid="arcade-ready" className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-y-auto bg-[var(--color-bg-surface)] p-4 text-center">
              {loadError ? (
                <>
                  <div role="alert">
                    <Text variant="body-md" tone="secondary" as="p">
                      {loadErrorText(loadError)}
                    </Text>
                  </div>
                  <Button variant="secondary" onPress={() => setAttempt((n) => n + 1)}>
                    {gameNewbieCopy.loadError.retry}
                  </Button>
                </>
              ) : (
                <>
                  <Text variant="body-md" as="p">
                    {fillCopy(`arcade.${k}.how`)}
                  </Text>
                  <Text variant="caption" tone="tertiary" as="p">
                    {fillCopy(`arcade.${k}.keys`)}
                  </Text>
                  <Button data-testid="arcade-start" size="lg" loading={!mounted} onPress={start}>
                    {fillCopy(authed ? 'arcade.play' : 'arcade.tryPlay')}
                  </Button>
                </>
              )}
            </div>
          )}

          {phase === 'ended' && end && (
            <div
              ref={resultRef}
              tabIndex={-1}
              data-testid="arcade-result"
              aria-labelledby="arcade-result-title"
              aria-busy={saving || undefined}
              className="absolute inset-0 flex flex-col gap-3 overflow-y-auto bg-[var(--color-bg-surface)] p-4 outline-none"
            >
              <Heading id="arcade-result-title" variant="title-sm" font="ui" as="h3">
                {fillCopy('arcade.result.title')}
              </Heading>
              <Heading variant="title-md" as="p" className="tabular-nums">
                {scoreLine?.text}
              </Heading>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {restLines.map((line) => (
                  <li key={line.text}>
                    {line.kind === 'best' ? (
                      <Badge tone="success">{line.text}</Badge>
                    ) : (
                      <Text variant="body-sm" tone={line.kind === 'error' ? 'danger' : 'secondary'} numeric>
                        {line.text}
                      </Text>
                    )}
                  </li>
                ))}
              </ul>
              {saving && <Skeleton height={56} />}
              {authed && save.state.status === 'error' && !save.state.invalid && (
                <div>
                  <Button variant="secondary" onPress={save.retry}>
                    {gameNewbieCopy.loadError.retry}
                  </Button>
                </div>
              )}
              {!authed && (
                <Link
                  href={loginHref(currentPath())}
                  className={`${ui.btnPrimary} py-2 text-center`}
                  onClick={rememberRun}
                  onAuxClick={rememberRun}
                >
                  {fillCopy('arcade.guest.login', { n: arcadeWaterFor(gameId, end.result.score) })}
                </Link>
              )}
              {tip && (
                <div className="flex flex-col items-start gap-2 rounded-card bg-[var(--color-bg-subtle)] p-3">
                  <Text variant="body-sm" as="p">
                    {tip.text}
                  </Text>
                  {tip.chip && <Chip href={tip.chip.to.web}>{tip.chip.label}</Chip>}
                </div>
              )}
              <div className="mt-auto flex flex-wrap gap-2 pt-2">
                <Button size="lg" onPress={start}>
                  {fillCopy('arcade.playAgain')}
                </Button>
                <Button size="lg" variant="secondary" onPress={onClose}>
                  {fillCopy('arcade.close')}
                </Button>
              </div>
            </div>
          )}
        </div>
        <p role="status" aria-live="polite" style={SR_ONLY}>
          {phase === 'ended' ? lines.map((l) => l.text).join('. ') : ''}
        </p>
      </div>
    </div>,
    document.body,
  );
}
