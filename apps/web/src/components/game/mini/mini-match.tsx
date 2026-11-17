'use client';

import { useEffect, useRef, useState } from 'react';
import { MINI_GAME_RULES, type MiniMatchCard } from '@tubutree/shared-types';
import { BOARD_TICK_MS, type MiniBoardProps } from '@tubutree/app-core/game-mini/boards';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { matchAnswers, matchCardState, matchDone, matchPairNo, matchSettle, matchStart, matchTap } from '@tubutree/app-core/game-mini/match-board';
import { Text } from '@/components/mini';

/**
 * Ghép Cặp: 60 giây, 12 thẻ ngửa (6 nguyên liệu, 6 công dụng), lưới 3 cột ở điện thoại, 4 cột từ 1024px. Chạm một nguyên liệu rồi chạm công dụng
 * hợp với nó: hai thẻ thành một cặp đánh số và giữ nguyên tới lúc nộp. Máy chủ giữ đáp án nên đúng/sai và dòng khoa học của từng cặp hiện ở màn kết
 * quả (xem `match-board.ts`). Hai thẻ cùng loại báo "không khớp" 800 ms rồi trở lại. Ghép đủ 6 cặp hoặc hết giờ thì nộp các cặp đã ghép.
 */
export default function MiniMatch({ content, onFinish, onStatus }: MiniBoardProps<{ cards: MiniMatchCard[] }>) {
  const cards = content.cards;
  const pairsTotal = Math.floor(cards.length / 2);
  const [p, setP] = useState(matchStart);
  const [startedAt] = useState(() => Date.now());
  const finished = useRef(false);
  const latest = useRef(p);
  latest.current = p;

  const finish = (answers: [string, string][]) => {
    if (finished.current) return;
    finished.current = true;
    onFinish(answers);
  };

  useEffect(() => {
    if (matchDone(p, cards)) finish(matchAnswers(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy khi tiến độ đổi; `finish` tự khoá một lần
  }, [p]);

  useEffect(() => {
    const until = p.mismatch?.until;
    if (until === undefined) return;
    const t = setTimeout(() => setP((cur) => matchSettle(cur, Date.now())), Math.max(0, until - Date.now()));
    return () => clearTimeout(t);
  }, [p.mismatch?.until]);

  useEffect(() => {
    const limit = MINI_GAME_RULES.match.timeLimitMs;
    const tick = () => {
      const left = Math.max(0, startedAt + limit - Date.now());
      onStatus({ msLeft: left, done: latest.current.pairs.length, total: pairsTotal });
      if (left <= 0) finish(matchAnswers(latest.current));
    };
    tick();
    const id = setInterval(tick, BOARD_TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- đồng hồ của cả ván chạy một lần từ lúc dựng
  }, [startedAt, pairsTotal, onStatus]);

  const tap = (cardId: string) => {
    if (finished.current) return;
    setP((cur) => matchTap(cur, cards, cardId, Date.now()));
  };

  return (
    <div className="tubu-mg-panel" data-testid="mini-match">
      <Text variant="body-sm" tone="secondary" as="p" aria-live="polite" data-testid="mini-match-hint">
        {gameCopy(p.mismatch ? 'match.mismatch' : 'match.hint')}
      </Text>
      <ul className="tubu-mg-grid" data-cols="match" aria-label={gameCopy('match.gridAria')}>
        {cards.map((c, i) => {
          const state = matchCardState(p, c.cardId);
          const pairNo = matchPairNo(p, c.cardId);
          const side = gameCopy(`match.side.${c.side}`);
          const aria =
            pairNo === null
              ? gameCopy('match.cardAria', { n: i + 1, label: c.label, side })
              : gameCopy('match.cardPairedAria', { n: i + 1, label: c.label, k: pairNo });
          return (
            <li key={c.cardId}>
              <button
                type="button"
                className="tubu-mg-tile"
                data-side={c.side}
                data-state={state}
                data-testid={`mini-match-card-${i}`}
                aria-pressed={state === 'selected' || state === 'paired'}
                aria-label={aria}
                onClick={() => tap(c.cardId)}
              >
                <span className="tubu-mg-tile-side" aria-hidden>
                  {pairNo === null ? side : gameCopy('match.pair', { k: pairNo })}
                </span>
                <span className="tubu-mg-tile-label" aria-hidden>
                  {c.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
