import { useCallback, useEffect, useRef, useState } from 'react';
import { MINI_GAME_RULES, mergeTier, type MergeDir } from '@tubutree/shared-types';
import { BOARD_TICK_MS, type MiniBoardProps } from '@tubutree/app-core/game-mini/boards';
import { arcadeCopy } from '@tubutree/app-core/game-mini/arcade-copy';
import { MERGE_TIER_ART } from '@tubutree/app-core/game-mini/arcade-art';
import { readArcadeBest } from '@tubutree/app-core/game-mini/arcade';
import {
  mergeGameMove,
  mergeGameSettle,
  mergeGameStart,
  mergeGameTier,
  mergeKeyDir,
  mergeTierName,
  type MergeGame,
} from '@tubutree/app-core/game-mini/eco-merge';
import { Text } from '../../ui/text';
import { formatNumber } from '../../../utils/format';
import { arcadeHaptic, arcadeStorage } from './arcade-platform';
import { useArcadeSound, useSwipe, useWindowKeys, useXmasSkin } from './mini-arcade-hooks';
import { ArcadeArt, SoundToggle } from './mini-arcade-ui';
import './mini-arcade.css';

type MergeContent = { seed: number; size: number; goal: number; maxMoves: number };

const CELLS = Array.from({ length: 16 }, (_, i) => i);
/** Chờ hoạt ảnh trượt/nảy xong rồi gỡ ô nguồn đã ghép. */
const SETTLE_MS = 160;
/** Thắng hoặc hết nước: để khách nhìn bàn cuối một chút rồi mới nộp. */
const END_HOLD_MS = 900;

/**
 * Ghép Mầm Xanh: 4×4, vuốt (Pointer Events, `touch-action: none` chỉ trên bàn) hoặc phím mũi tên. Mỗi ô giữ mã riêng nên CSS dời ô mượt
 * bằng `transform` theo `data-cell`; ô vừa ghép nảy, ô mới mọc lên. Bài nộp là chuỗi hướng đã vuốt (`path`), máy chủ chơi lại để chấm. Ván xong khi tới
 * Rừng Tubu, hết nước đi hoặc hết 3 phút.
 */
export default function MiniEcoMerge({ content, onFinish, onStatus }: MiniBoardProps<MergeContent>) {
  const [game, setGame] = useState<MergeGame>(() => mergeGameStart(content.seed, content.goal, content.size));
  const gameRef = useRef(game);
  const [startedAt] = useState(() => Date.now());
  const [best] = useState(() => readArcadeBest(arcadeStorage(), 'eco_merge'));
  const sound = useArcadeSound();
  const synth = sound.synth;
  const skin = useXmasSkin();
  const tierName = skin ? skin.xmasTierName : mergeTierName;
  const [toast, setToast] = useState<{ key: number; text: string } | null>(null);
  const finished = useRef(false);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onFinish([gameRef.current.path]);
  }, [onFinish]);

  useEffect(() => {
    const limit = MINI_GAME_RULES.eco_merge.timeLimitMs;
    const tick = () => {
      const left = Math.max(0, startedAt + limit - Date.now());
      onStatus({ msLeft: left, done: mergeGameTier(gameRef.current), total: MINI_GAME_RULES.eco_merge.items });
      if (left <= 0) finish();
    };
    tick();
    const id = setInterval(tick, BOARD_TICK_MS);
    return () => clearInterval(id);
  }, [startedAt, onStatus, finish]);

  useEffect(() => {
    if (!game.won && !game.over) return;
    synth.play(game.won ? (skin ? 'jingle' : 'win') : 'over');
    arcadeHaptic(game.won ? 'win' : 'wrong');
    const t = setTimeout(finish, END_HOLD_MS);
    return () => clearTimeout(t);
    // Chỉ khi ván vừa chuyển sang thắng/hết nước.
  }, [game.won, game.over]);

  useEffect(() => {
    if (!game.tiles.some((t) => t.state !== 'idle')) return;
    const t = setTimeout(() => {
      const settled = mergeGameSettle(gameRef.current);
      gameRef.current = settled;
      setGame(settled);
    }, SETTLE_MS);
    return () => clearTimeout(t);
  }, [game]);

  const move = (dir: MergeDir) => {
    if (finished.current) return;
    const cur = gameRef.current;
    const next = mergeGameMove(cur, dir);
    if (next === cur) return;
    gameRef.current = next;
    setGame(next);
    if (next.lastMerges > 1) {
      synth.play(skin ? 'bell' : 'combo');
      arcadeHaptic('combo');
      setToast({ key: next.path.length, text: arcadeCopy('merge.combo', { n: next.lastMerges }) });
    } else if (next.lastMerges === 1) {
      synth.play('merge');
      arcadeHaptic('merge');
    }
    if (next.newTier >= 3 && !next.won) setToast({ key: next.path.length, text: arcadeCopy('merge.reached', { tier: tierName(2 ** next.newTier) }) });
  };
  useWindowKeys(mergeKeyDir, move);
  const swipe = useSwipe(move);

  const end = game.won ? (skin?.XMAS_MERGE_WIN ?? arcadeCopy('merge.win')) : game.over ? arcadeCopy('merge.over') : null;
  return (
    <div className="tubu-mg-panel tubu-ar-merge" data-testid="mini-eco-merge" data-season={skin ? 'christmas' : undefined}>
      <div className="tubu-ar-hud">
        <div className="tubu-ar-stat">
          <Text variant="caption" tone="secondary" as="span">
            {arcadeCopy('merge.score')}
          </Text>
          <Text variant="label" as="span" numeric data-testid="eco-merge-score">
            {formatNumber(game.score)}
          </Text>
        </div>
        <div className="tubu-ar-stat">
          <Text variant="caption" tone="secondary" as="span">
            {arcadeCopy('merge.best')}
          </Text>
          <Text variant="label" as="span" numeric data-testid="eco-merge-best">
            {formatNumber(Math.max(best, game.score))}
          </Text>
        </div>
        <SoundToggle on={sound.on} onToggle={sound.toggle} />
      </div>
      <div
        className="tubu-ar-grid"
        role="application"
        tabIndex={0}
        aria-label={arcadeCopy('merge.gridAria')}
        data-testid="eco-merge-grid"
        data-moves={game.path.length}
        {...swipe}
      >
        {CELLS.map((c) => (
          <span key={c} className="tubu-ar-cell" aria-hidden />
        ))}
        {game.tiles.map((t) => {
          const tier = Math.max(1, mergeTier(t.value));
          return (
            <div
              key={t.id}
              className="tubu-ar-tile"
              data-tier={tier}
              data-state={t.state}
              data-testid={t.state === 'gone' ? undefined : 'eco-merge-tile'}
              data-value={t.value}
              data-cell={t.cell}
              aria-hidden={t.state === 'gone' || undefined}
            >
              <span className="tubu-ar-tile-inner">
                <span className="tubu-ar-tile-num" aria-hidden>
                  {t.value}
                </span>
                <ArcadeArt shapes={(skin?.XMAS_MERGE_ART ?? MERGE_TIER_ART)[tier] ?? []} />
                <span className="tubu-ar-tile-name">{tierName(t.value)}</span>
              </span>
            </div>
          );
        })}
        {toast && (
          <span key={toast.key} className="tubu-ar-toast" role="status">
            {toast.text}
          </span>
        )}
        {end && (
          <div className="tubu-ar-end" role="status" data-testid="eco-merge-end" data-won={game.won}>
            {end}
          </div>
        )}
      </div>
      <Text variant="caption" tone="secondary" as="p">
        {arcadeCopy('merge.hint')}
      </Text>
    </div>
  );
}
