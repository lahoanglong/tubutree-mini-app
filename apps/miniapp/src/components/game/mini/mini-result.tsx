import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { arcadeCopy } from '@tubutree/app-core/game-mini/arcade-copy';
import { arcadeResultCelebration, arcadeResultView, isMiniArcadeGameId, readArcadeBest, saveArcadeBest } from '@tubutree/app-core/game-mini/arcade';
import { createArcadeSynth, readSoundOn } from '@tubutree/app-core/game-mini/arcade-sfx';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { MINI_RECYCLE_PATH, miniResultSummary, sourceHost, type PlayableMiniGame } from '@tubutree/app-core/game-mini/format';
import { kitchenReviewRows } from '@tubutree/app-core/game-mini/kitchen';
import { MINI_REVIEW_BADGE, miniReviewRows, type MiniReviewRow } from '@tubutree/app-core/game-mini/review';
import type { RoundState } from '@tubutree/app-core/game-mini/round-machine';
import { xmasTierName } from '@tubutree/app-core/seasonal/xmas-tier-names';
import { Button } from '../../ui/button';
import { Heading, Text } from '../../ui/text';
import { SilentBoundary } from '../../route-shell';
import { usePublicConfig } from '../../../hooks/use-public-config';
import { useSmartNavigate } from '../../../lib/smart-nav';
import { arcadeStorage } from './arcade-platform';
import { formatNumber } from '../../../utils/format';

// Sản phẩm của ván và "Thêm vào giỏ" là một chunk lười riêng; Đúng Thùng không có sản phẩm nên không tải nó. Tải chunk lỗi (mạng chập chờn)
// thì chỉ khối này biến mất, điểm và "Vì sao" của ván vẫn còn.
const ResultProducts = lazy(() => import('./mini-result-cart'));
const AlbumLine = lazy(() => import('../../../pages/game-album').then((m) => ({ default: m.AlbumLine })));

/** Nguồn ở Mini App: chỉ hiện tên miền, vì chính sách Zalo không cho Mini App mở trang ngoài Zalo. */
function SourceNote({ url }: { url: string }) {
  const host = sourceHost(url);
  if (!host) return null;
  return (
    <Text variant="caption" tone="tertiary" as="p">
      {gameCopy('result.sourceHost', { host })}
    </Text>
  );
}

function ReviewList({ rows }: { rows: MiniReviewRow[] }) {
  return (
    <ol className="tubu-mg-review" data-testid="mini-review">
      {rows.map((r) => (
        <li key={r.key} className="tubu-mg-review-item" data-testid="mini-review-item">
          <span className="tubu-mg-badge" data-state={r.state}>
            {gameCopy(MINI_REVIEW_BADGE[r.state])}
          </span>
          <Text variant="body-sm" as="p" style={{ fontWeight: 'var(--type-label-weight)' }}>
            {r.title}
          </Text>
          {r.state === 'wrong' && r.given && (
            <Text variant="caption" tone="secondary" as="p">
              {gameCopy('result.given', { a: r.given })}
            </Text>
          )}
          {r.state !== 'correct' && r.expected && (
            <Text variant="caption" tone="secondary" as="p">
              {gameCopy('result.expected', { a: r.expected })}
            </Text>
          )}
          <Text variant="body-sm" as="p">
            <strong>{gameCopy('result.why')}: </strong>
            {r.explanation}
          </Text>
          <SourceNote url={r.sourceUrl} />
        </li>
      ))}
    </ol>
  );
}

/**
 * Màn kết quả (chunk lười `mini-result`, khung ván tải trước lúc bắt đầu chơi): điểm, phần thưởng, một nút chính, sản phẩm vừa học, "Vì sao".
 * Game thao tác (Ghép Mầm Xanh, Băng Chuyền Xanh) thay "Vì sao" bằng dòng điểm ván, kỷ lục trên máy và nút phụ "Chơi lại".
 */
export default function MiniResult({
  game,
  state,
  onDone,
  onLogin,
  onAgain,
}: {
  game: PlayableMiniGame;
  state: RoundState;
  onDone: () => void;
  onLogin: () => void;
  onAgain?: () => void;
}) {
  const navigate = useSmartNavigate();
  const config = usePublicConfig();
  const waste = config.waste.enabled;
  const jingle = config.seasonalTheme === 'christmas';
  const r = state.result!;
  const summary = miniResultSummary(r);
  const arcade = arcadeResultView(r.review, jingle ? xmasTierName : undefined);
  // Đọc kỷ lục cũ một lần trước khi ghi điểm ván này, để chữ "Kỷ lục mới" không mất khi màn vẽ lại.
  const [previousBest] = useState(() => (isMiniArcadeGameId(game) ? readArcadeBest(arcadeStorage(), game) : 0));
  useEffect(() => {
    if (arcade && isMiniArcadeGameId(game)) saveArcadeBest(arcadeStorage(), game, arcade.score);
  }, [arcade?.score, game]);
  const newBest = arcade !== null && previousBest > 0 && arcade.score > previousBest;
  // Lấp lánh và hồi chuông (chuông Noel khi bật mùa) theo `arcadeResultCelebration`, tiếng theo nút âm thanh của bàn chơi. Bộ phát tạo ở đây
  // (không qua useArcadeSound) để chunk kết quả không kéo theo chunk hook của bàn chơi.
  const party = arcadeResultCelebration(r.review);
  const [synth] = useState(() =>
    createArcadeSynth(() => readSoundOn(arcadeStorage(), typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true)),
  );
  useEffect(() => () => synth.close(), [synth]);
  // Một hồi cho một màn kết quả: cấu hình mùa về muộn (đổi `jingle`) không kêu lại lần hai.
  const played = useRef(false);
  useEffect(() => {
    if (!party.sound || played.current) return;
    played.current = true;
    synth.play(jingle ? 'jingle' : 'win');
  }, [party.sound, jingle, synth]);
  return (
    <section className="tubu-mg-panel" aria-labelledby="mini-result-title" data-testid="mini-result">
      <Heading id="mini-result-title" as="h2" variant="title-md" font="ui">
        {gameCopy('result.title')}
      </Heading>
      <Heading as="p" variant="display-md" className="tubu-mg-score" data-testid="mini-result-score">
        {arcade?.headline ?? summary.score}
        {party.sparkle && <span className="tubu-mg-sparkle" aria-hidden data-testid="mini-result-sparkle" />}
      </Heading>
      {arcade && (
        <div className="tubu-mg-gains" data-testid="mini-result-arcade">
          <Text variant="body-md" as="p" numeric>
            {arcade.line}
          </Text>
          {newBest ? (
            <span className="tubu-mg-chip" data-tone="brand" data-testid="mini-result-best">
              {arcadeCopy('result.best')}
            </span>
          ) : (
            previousBest > 0 && (
              <Text variant="caption" tone="secondary" as="p" numeric>
                {arcadeCopy('result.bestWas', { n: formatNumber(previousBest) })}
              </Text>
            )
          )}
        </div>
      )}
      {summary.gains.length > 0 && (
        <div className="tubu-mg-gains">
          {summary.gains.map((g) => (
            <span key={g} className="tubu-mg-chip" data-tone="brand">
              {g}
            </span>
          ))}
        </div>
      )}
      {summary.notes.length > 0 && (
        <ul className="tubu-mg-lines" aria-live="polite">
          {summary.notes.map((n) => (
            <li key={n}>
              <Text variant="body-sm" tone="secondary" as="span">
                {n}
              </Text>
            </li>
          ))}
        </ul>
      )}
      <Button fullWidth size="lg" onPress={summary.loginToReward ? onLogin : onDone}>
        {gameCopy(summary.loginToReward ? 'result.login' : 'result.done')}
      </Button>
      {arcade ? (
        onAgain && (
          <Button fullWidth size="lg" variant="secondary" onPress={onAgain}>
            {gameCopy('result.again')}
          </Button>
        )
      ) : (
        <>
          <SilentBoundary>
            <Suspense fallback={null}>
              <AlbumLine roundId={r.roundId} />
            </Suspense>
          </SilentBoundary>
          {game === 'sort' && waste && (
            <button type="button" className="tubu-mg-link" onClick={() => navigate(MINI_RECYCLE_PATH.miniapp)}>
              {gameCopy('invite.sort')}
            </button>
          )}
          {game !== 'sort' && (
            <SilentBoundary>
              <Suspense fallback={null}>
                <ResultProducts game={game} state={state} />
              </Suspense>
            </SilentBoundary>
          )}
          <Heading as="h3" variant="title-sm" font="ui">
            {gameCopy('result.review')}
          </Heading>
          {state.round && (
            <ReviewList rows={game === 'kitchen_swap' ? kitchenReviewRows(r.review, state.round.content) : miniReviewRows(r.review, state.round.content, state.answers)} />
          )}
        </>
      )}
    </section>
  );
}
