import { useId, useMemo } from 'react';
import { useNavigate } from 'zmp-ui';
import type { ArcadeCompleteResult } from '@tubutree/app-core/api/game';
import { arcadeWaterFor } from '@tubutree/app-core/arcade/arcade-config';
import { endTip } from '@tubutree/app-core/arcade/arcade-tips';
import type { ArcadeResult } from '@tubutree/app-core/arcade/arcade-canvas';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { vi } from '../../i18n/vi';
import { haptic } from '../../utils/haptic';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Chip } from '../ui/chip';
import { Heading, Text } from '../ui/text';
import type { ArcadeSaveStatus } from './use-arcade-complete';
import '../../css/arcade.css';

// Khoá theo chuỗi: lý do máy chủ trả thêm mà bảng này chưa biết thì không hiện dòng giải thích, chứ không làm hỏng bảng điểm.
const REASON_COPY: Record<string, string> = {
  DAILY_CAP: 'arcade.result.capped',
  TOO_FAST: 'arcade.result.tooFast',
  NOT_REAL_USER: 'arcade.result.notReal',
  DISABLED: 'arcade.result.disabled',
  LOW_SCORE: 'arcade.result.lowScore',
};

export interface ArcadeResultPanelProps {
  run: ArcadeResult;
  /** Khách thật đã đăng nhập (`useRealUser`): tài khoản khách theo thiết bị cũng là `false`, vì máy chủ không phát thưởng cho họ. */
  real: boolean;
  save: { status: ArcadeSaveStatus; result: ArcadeCompleteResult | null };
  /** Kỷ lục chơi thử của khách (lưu trên máy); đã đăng nhập thì lấy từ máy chủ. */
  local: { best: number; isNewBest: boolean } | null;
  onRetrySave: () => void;
  onLogin: () => void | Promise<void>;
  onPlayAgain: () => void;
  onClose: () => void;
}

/**
 * Bảng kết quả cuối ván. Vùng `aria-live="polite"` gồm điểm, kỷ lục và phần thưởng: phần thưởng về muộn sau máy chủ nên được đọc khi xuất hiện.
 * Lỗi lưu không làm mất bảng điểm: hiện câu báo và nút thử lại cho đúng ván này.
 */
export function ArcadeResultPanel({ run, real, save, local, onRetrySave, onLogin, onPlayAgain, onClose }: ArcadeResultPanelProps) {
  const navigate = useNavigate();
  const headingId = useId();
  const tip = useMemo(() => endTip(run.gameId, run.stats), [run]);
  const saved = save.result;
  const best = saved ? { best: saved.bestScore, isNewBest: saved.isNewBest } : real ? null : local;

  return (
    <div className="tubu-arcade-panel" role="region" aria-labelledby={headingId} data-testid="arcade-result">
      <div className="tubu-arcade-live" aria-live="polite">
        <Heading as="h3" id={headingId} variant="title-sm" font="ui">
          {fillCopy('arcade.result.title')}
        </Heading>
        <Heading as="p" variant="title-lg" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {fillCopy('arcade.result.score', { n: run.score })}
        </Heading>
        {best && best.best > 0 && (
          <div className="tubu-arcade-best-row">
            <Text variant="body-sm" tone="secondary" numeric>
              {fillCopy('arcade.best', { n: best.best })}
            </Text>
            {best.isNewBest && <Badge tone="brand">{fillCopy('arcade.newBest')}</Badge>}
          </div>
        )}
        {real && save.status === 'saving' && <div className="tubu-skeleton tubu-arcade-saving" aria-hidden data-testid="arcade-saving" />}
        {real && save.status === 'error' && (
          <Text variant="body-sm" tone="danger" as="p">
            {fillCopy('arcade.result.error')}
          </Text>
        )}
        {real && save.status === 'invalid' && (
          <Text variant="body-sm" tone="danger" as="p">
            {fillCopy('arcade.result.invalid')}
          </Text>
        )}
        {saved && <SavedRewards saved={saved} />}
        {!real && (
          <Text variant="caption" tone="secondary" as="p">
            {fillCopy('arcade.guest.demo')}
          </Text>
        )}
      </div>

      {real && save.status === 'error' && (
        <Button variant="secondary" onPress={onRetrySave}>
          {vi.common.retry}
        </Button>
      )}
      {!real && (
        <Button
          onPress={() => {
            haptic('light');
            return onLogin();
          }}
        >
          {fillCopy('arcade.guest.login', { n: arcadeWaterFor(run.gameId, run.score) })}
        </Button>
      )}

      <Text variant="body-sm" tone="secondary" as="p">
        {tip.text}
      </Text>
      {tip.chip && (
        <div>
          <Chip
            style={{ minHeight: 'var(--arcade-hit-min)' }}
            onPress={() => {
              onClose();
              navigate(tip.chip!.to.miniapp);
            }}
          >
            {tip.chip.label}
          </Chip>
        </div>
      )}

      <div className="tubu-arcade-actions">
        <Button onPress={onPlayAgain}>{fillCopy('arcade.playAgain')}</Button>
        <Button variant="secondary" onPress={onClose}>
          {fillCopy('arcade.close')}
        </Button>
      </div>
    </div>
  );
}

function SavedRewards({ saved }: { saved: ArcadeCompleteResult }) {
  const reason = saved.reason ? (REASON_COPY[saved.reason] ?? null) : null;
  return (
    <ul className="tubu-arcade-rewards" data-testid="arcade-rewards">
      {saved.waterEarned > 0 && (
        <li>
          <Text variant="body-md" tone="brand" numeric>
            {fillCopy('arcade.result.water', { n: saved.waterEarned })}
          </Text>
        </li>
      )}
      {saved.pointsEarned > 0 && (
        <li>
          <Text variant="body-sm" tone="brand" numeric>
            {fillCopy('arcade.result.points', { n: saved.pointsEarned })}
          </Text>
        </li>
      )}
      {reason && (
        <li>
          <Text variant="body-sm" tone="secondary">
            {fillCopy(reason)}
          </Text>
        </li>
      )}
      {(saved.reason === null || saved.reason === 'DAILY_CAP' || saved.reason === 'LOW_SCORE') && saved.cap > 0 && (
        <li>
          <Text variant="caption" tone="secondary" numeric>
            {fillCopy('arcade.result.used', { n: saved.used, m: saved.cap })}
          </Text>
        </li>
      )}
      {saved.windowBonus && (
        <li>
          <Text variant="caption" tone="secondary">
            {fillCopy('arcade.result.window')}
          </Text>
        </li>
      )}
    </ul>
  );
}
