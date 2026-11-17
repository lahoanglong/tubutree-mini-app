import { lazy, Suspense } from 'react';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { MINI_RECYCLE_PATH, miniResultSummary, sourceHost, type PlayableMiniGame } from '@tubutree/app-core/game-mini/format';
import { MINI_REVIEW_BADGE, miniReviewRows, type MiniReviewRow } from '@tubutree/app-core/game-mini/review';
import type { RoundState } from '@tubutree/app-core/game-mini/round-machine';
import { Button } from '../../ui/button';
import { Heading, Text } from '../../ui/text';
import { usePublicConfig } from '../../../hooks/use-public-config';
import { useSmartNavigate } from '../../../lib/smart-nav';

// Khối sản phẩm (và mã thêm giỏ của Giỏ Đúng Việc) là chunk riêng để màn kết quả giữ dưới trần 6 KB; tải ngay khi chunk này tải (lúc đang chơi)
// nên khối hiện cùng lúc với điểm.
const loadProducts = () => import('./mini-result-products');
const MiniResultProducts = lazy(loadProducts);
void loadProducts();

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

/** Màn kết quả (chunk lười `mini-result`, khung ván tải trước lúc bắt đầu chơi): điểm, phần thưởng, một nút chính, danh sách "Vì sao". */
export default function MiniResult({ game, state, onDone, onLogin }: { game: PlayableMiniGame; state: RoundState; onDone: () => void; onLogin: () => void }) {
  const navigate = useSmartNavigate();
  const waste = usePublicConfig().waste.enabled;
  const r = state.result!;
  const summary = miniResultSummary(r);
  return (
    <section className="tubu-mg-panel" aria-labelledby="mini-result-title" data-testid="mini-result">
      <Heading id="mini-result-title" as="h2" variant="title-md" font="ui">
        {gameCopy('result.title')}
      </Heading>
      <Heading as="p" variant="display-md" className="tubu-mg-score" data-testid="mini-result-score">
        {summary.score}
      </Heading>
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
      {game === 'sort' && waste && (
        <button type="button" className="tubu-mg-link" onClick={() => navigate(MINI_RECYCLE_PATH.miniapp)}>
          {gameCopy('invite.sort')}
        </button>
      )}
      {game !== 'sort' && (
        <Suspense fallback={null}>
          <MiniResultProducts game={game} state={state} />
        </Suspense>
      )}
      <Heading as="h3" variant="title-sm" font="ui">
        {gameCopy('result.review')}
      </Heading>
      {state.round && <ReviewList rows={miniReviewRows(r.review, state.round.content, state.answers)} />}
    </section>
  );
}
