import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pause, Play, X } from 'lucide-react';
import type { ArcadeGameId } from '@tubutree/app-core/arcade/arcade-config';
import type { ArcadeResult, mountArcade } from '@tubutree/app-core/arcade/arcade-canvas';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useLoginWithNotice } from '../../hooks/use-login-notice';
import { useRealUser } from '../../hooks/use-real-user';
import { getLoadErrorMessage } from '../../services/api';
import { startArcadeRun } from '../../services/arcade-api';
import { Button } from '../ui/button';
import { ErrorState } from '../ui/empty-state';
import { IconButton } from '../ui/icon-button';
import { Heading, Text } from '../ui/text';
import { saveLocalBest } from './arcade-best';
import { ArcadeResultPanel } from './arcade-result';
import { prefersReducedMotion, readArcadeTheme } from './arcade-theme';
import { useArcadeComplete, type PlayedRun, type RunIdPromise } from './use-arcade-complete';
import { sfx } from '../../utils/sfx';
import '../../css/arcade.css';

type Controller = ReturnType<typeof mountArcade>;
type Phase = 'ready' | 'playing' | 'paused' | 'result';

const COPY_KEY = { dew_catcher: 'dew', refill_rush: 'rush' } as const;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type ArcadeEngine = { mountArcade: typeof mountArcade };
let engine: Promise<ArcadeEngine> | null = null;
// Một lời gọi import() cho cả đời trang: hai lớp phủ liên tiếp hay hai lần chạy effect (Strict Mode) dùng chung kết quả. Nạp lỗi thì bỏ để "Thử lại" gọi lại được.
const loadEngine = (): Promise<ArcadeEngine> => {
  engine ??= import('@tubutree/app-core/arcade/arcade-canvas').catch((error: unknown) => {
    engine = null;
    throw error;
  });
  return engine;
};

export interface ArcadeGameOverlayProps {
  gameId: ArcadeGameId;
  /** `theme.seasonal` là "christmas": Hứng Giọt Sương mặc áo Noel (tên, cách chơi, hình vẽ, tiếng chuông); luật và điểm không đổi. */
  xmas?: boolean;
  onClose: () => void;
}

/**
 * Lớp phủ toàn màn của một mini game (không có route riêng): canvas do `mountArcade` của app-core vẽ, nạp bằng `import()` ở lần mở đầu để gói đầu không gánh engine.
 * Ba pha: màn bắt đầu → đang chơi (có Tạm dừng) → bảng kết quả. Đã đăng nhập thì gửi ván đúng một lần (`useArcadeComplete`); khách chơi trọn vẹn, kỷ lục lưu trên máy
 * và nút đăng nhập nêu số Giọt nước nhận được. Mở thì khoá cuộn nền; đóng thì trả focus về nút đã mở nó.
 */
export function ArcadeGameOverlay({ gameId, xmas = false, onClose }: ArcadeGameOverlayProps) {
  const real = useRealUser();
  const login = useLoginWithNotice();
  const key = COPY_KEY[gameId];
  // Chốt áo lúc mở lớp phủ: cấu hình mùa về muộn (hay đổi giữa ván) không được đổi `skin`, vì effect dựng engine phụ thuộc nó và sẽ huỷ ván đang chơi.
  const [skin] = useState(() => xmas && gameId === 'dew_catcher');
  const title = fillCopy(skin ? 'arcade.dew.xmasTitle' : `arcade.${key}.title`);
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controller = useRef<Controller | null>(null);
  const phaseRef = useRef<Phase>('ready');
  const endedRef = useRef(false);
  // Promise mã ván của lần bấm Chơi gần nhất. Lúc ván kết thúc, `handleEnd` chụp promise của CHÍNH ván đó (kèm vào `run`) nên lời đáp muộn của ván cũ không đè mã ván mới,
  // và mã về sau lúc kết thúc vẫn được chờ trước khi gửi.
  const runIdRef = useRef<RunIdPromise>(Promise.resolve(null));
  const realRef = useRef(real);
  realRef.current = real;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const [phase, setPhaseState] = useState<Phase>('ready');
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [run, setRun] = useState<PlayedRun | null>(null);
  const [local, setLocal] = useState<{ best: number; isNewBest: boolean } | null>(null);
  const save = useArcadeComplete(run, real);

  const setPhase = (next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  };

  // `onEnd` có thể bắn lại (engine tự bảo vệ, nhưng bảng điểm không được dựa vào đó): ván chỉ được ghi nhận một lần.
  const handleEnd = (result: ArcadeResult) => {
    if (endedRef.current) return;
    endedRef.current = true;
    if (!realRef.current) setLocal(saveLocalBest(result.gameId, result.score));
    setRun({ ...result, runId: runIdRef.current });
    setPhase('result');
  };
  const handleEndRef = useRef(handleEnd);
  handleEndRef.current = handleEnd;

  useEffect(() => {
    let cancelled = false;
    let mounted: Controller | null = null;
    // Áo Noel của Dew nạp lười cùng engine; nạp lỗi thì chơi áo thường.
    Promise.all([loadEngine(), skin ? import('@tubutree/app-core/seasonal/xmas-dew').catch(() => null) : null]).then(
      ([{ mountArcade: mount }, xmasDew]) => {
        const canvas = canvasRef.current;
        const root = rootRef.current;
        if (cancelled || !canvas || !root) return;
        mounted = mount({
          game: gameId,
          canvas,
          theme: readArcadeTheme(root),
          reducedMotion: prefersReducedMotion(),
          skin: xmasDew?.xmasDewSkin(prefersReducedMotion(), () => sfx.play('bell')),
          raf: (cb) => window.requestAnimationFrame(cb),
          caf: (id) => window.cancelAnimationFrame(id),
          now: () => performance.now(),
          onEnd: (result) => handleEndRef.current(result),
        });
        controller.current = mounted;
        setLoaded(true);
      },
      (error: unknown) => {
        if (!cancelled) setLoadError(error);
      },
    );
    return () => {
      cancelled = true;
      mounted?.destroy();
      controller.current = null;
    };
  }, [gameId, attempt, skin]);

  const measure = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !controller.current) return;
    const box = stage.getBoundingClientRect();
    controller.current.resize(box.width, box.height, window.devicePixelRatio || 1);
  }, []);
  useEffect(() => {
    const stage = stageRef.current;
    if (!loaded || !stage) return;
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [loaded, measure]);

  // Tab ẩn thì tạm dừng, quay lại thì chơi tiếp; tạm dừng do khách bấm nút thì không tự chạy lại.
  useEffect(() => {
    let hiddenWhilePlaying = false;
    const onVisibility = () => {
      const ctl = controller.current;
      if (!ctl) return;
      if (document.visibilityState === 'hidden') {
        if (phaseRef.current !== 'playing') return;
        ctl.pause();
        hiddenWhilePlaying = true;
      } else if (hiddenWhilePlaying) {
        hiddenWhilePlaying = false;
        if (phaseRef.current === 'playing') ctl.resume();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    // Nhớ nút đã mở lớp phủ: không trả focus thì focus rơi về body và khách phải Tab lại từ đầu trang.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    rootRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = rootRef.current;
      if (!root) return;
      // aria-modal không tự giữ focus: Tab ở nút cuối quay về nút đầu (và ngược lại) để không lọt ra trang Vườn phía sau. Nút Tạm dừng ẩn bằng visibility không focus được nên bỏ.
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.style.visibility !== 'hidden');
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      const outside = !root.contains(active) || active === root;
      if (e.shiftKey && (active === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || (outside && active !== root))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (opener && opener !== document.body && opener.isConnected) opener.focus();
    };
  }, []);

  const begin = () => {
    const ctl = controller.current;
    if (!ctl) return;
    endedRef.current = false;
    // Không chặn vào ván (ván bắt đầu ở máy khách, máy chủ chỉ đo từ lúc nhận mã): lúc lưu mới chờ mã. Xin mã lỗi thì ván không có mã và bảng điểm báo không hợp lệ.
    runIdRef.current = startArcadeRun(gameId).then(
      (started): string | null => started.runId,
      () => null,
    );
    setRun(null);
    setLocal(null);
    setPhase('playing');
    ctl.start();
    canvasRef.current?.focus({ preventScroll: true });
  };
  const togglePause = () => {
    const ctl = controller.current;
    if (!ctl) return;
    if (phaseRef.current === 'playing') {
      ctl.pause();
      setPhase('paused');
    } else if (phaseRef.current === 'paused') {
      ctl.resume();
      setPhase('playing');
      canvasRef.current?.focus({ preventScroll: true });
    }
  };
  const retryLoad = () => {
    setLoadError(null);
    setAttempt((n) => n + 1);
  };

  const pausable = phase === 'playing' || phase === 'paused';
  return createPortal(
    <div ref={rootRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="tubu-arcade" data-testid="arcade-overlay" data-phase={phase}>
      <div className="tubu-arcade-bar">
        <IconButton icon={X} label={fillCopy('arcade.close')} onPress={onClose} />
        <IconButton
          icon={phase === 'paused' ? Play : Pause}
          label={fillCopy(phase === 'paused' ? 'arcade.resume' : 'arcade.pause')}
          onPress={togglePause}
          style={{ visibility: pausable ? 'visible' : 'hidden' }}
        />
        <Heading as="h2" id={titleId} variant="title-sm" font="ui" className="tubu-arcade-title">
          {title}
        </Heading>
      </div>
      <div ref={stageRef} className="tubu-arcade-stage">
        <canvas ref={canvasRef} tabIndex={0} aria-label={fillCopy(`arcade.${key}.aria`)} className="tubu-arcade-canvas" data-testid="arcade-canvas" />
        {phase === 'ready' && (
          <div className="tubu-arcade-cover" data-testid="arcade-ready">
            {loadError ? (
              <ErrorState variant="inline" title={title} message={getLoadErrorMessage(loadError)} onRetry={retryLoad} />
            ) : (
              <>
                <Text variant="body-md" as="p">
                  {fillCopy(skin ? 'arcade.dew.xmasHow' : `arcade.${key}.how`)}
                </Text>
                <Text variant="caption" tone="secondary" as="p" className="tubu-arcade-keys">
                  {fillCopy(`arcade.${key}.keys`)}
                </Text>
                <Button loading={!loaded} onPress={begin}>
                  {fillCopy(real ? 'arcade.play' : 'arcade.tryPlay')}
                </Button>
                {!real && (
                  <Text variant="caption" tone="secondary" as="p">
                    {fillCopy('arcade.guest.demo')}
                  </Text>
                )}
              </>
            )}
          </div>
        )}
        {phase === 'paused' && (
          <div className="tubu-arcade-cover" data-testid="arcade-paused">
            <Button icon={Play} onPress={togglePause}>
              {fillCopy('arcade.resume')}
            </Button>
          </div>
        )}
        {phase === 'result' && run && (
          <ArcadeResultPanel
            run={run}
            real={real}
            save={save}
            local={local}
            onRetrySave={save.retry}
            onLogin={() => login()}
            onPlayAgain={begin}
            onClose={onClose}
            xmas={skin}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
