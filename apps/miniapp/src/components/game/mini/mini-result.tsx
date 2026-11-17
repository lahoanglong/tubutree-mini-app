import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { MINI_RECYCLE_PATH, miniProductPath, miniResultSummary, sourceHost, type PlayableMiniGame } from '@tubutree/app-core/game-mini/format';
import { MINI_REVIEW_BADGE, miniProductView, miniQuizProduct, miniReviewRows, type MiniReviewRow } from '@tubutree/app-core/game-mini/review';
import type { RoundState } from '@tubutree/app-core/game-mini/round-machine';
import { Button } from '../../ui/button';
import { ProductTile } from '../../ui/product-tile';
import { Heading, Text } from '../../ui/text';
import { usePublicConfig } from '../../../hooks/use-public-config';
import { useSmartNavigate } from '../../../lib/smart-nav';

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
  const product = miniQuizProduct(state.round?.content);
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
      {game === 'daily_quiz' && product && (
        <div className="tubu-mg-panel">
          <Text variant="caption" tone="secondary" as="p">
            {gameCopy('result.product')}
          </Text>
          <div data-testid="mini-result-product">
            <ProductTile view={miniProductView(product)} variant="line" href={miniProductPath.miniapp(product.slug, game)} />
          </div>
        </div>
      )}
      <Heading as="h3" variant="title-sm" font="ui">
        {gameCopy('result.review')}
      </Heading>
      {state.round && <ReviewList rows={miniReviewRows(r.review, state.round.content)} />}
    </section>
  );
}
