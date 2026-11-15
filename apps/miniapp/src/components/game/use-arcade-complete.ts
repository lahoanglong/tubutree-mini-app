import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isArcadeRunRejected, isArcadeRunReplayed, type ArcadeCompleteResult } from '@tubutree/app-core/api/game';
import type { ArcadeResult } from '@tubutree/app-core/arcade/arcade-canvas';
import { submitArcadeRun } from '../../services/arcade-api';

/** `invalid` = máy chủ từ chối chính ván này (400), `replayed` = 409 mã ván đã dùng (thường là lần gửi trước đã ghi mà phản hồi bị mất), `error` = lỗi tạm, thử lại được. */
export type ArcadeSaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'invalid' | 'replayed';

/** Mã ván của một ván: resolve `null` khi `arcade-start` không tới được máy chủ. Không bao giờ reject. */
export type RunIdPromise = Promise<string | null>;

/** Ván đã chơi xong kèm PROMISE mã ván lấy lúc bấm Chơi (của riêng ván này): lời đáp có thể về sau lúc ván kết thúc nên `send` chờ nó; resolve `null` khi xin mã lỗi. */
export type PlayedRun = ArcadeResult & { runId: RunIdPromise };

interface Slot {
  run: PlayedRun;
  status: 'saving' | 'saved' | 'error' | 'invalid' | 'replayed';
  result?: ArcadeCompleteResult;
}

/**
 * Gửi kết quả MỘT ván đã đăng nhập lên máy chủ đúng một lần: theo đối tượng `run` (không theo lần vẽ), nên vẽ lại, Strict Mode hay `onEnd` bắn hai lần
 * không gửi thêm. Mã ván có thể chưa về lúc ván kết thúc: `send` chờ promise mã của chính ván đó (trạng thái `saving`, không nháy lỗi) rồi mới gửi.
 * Lỗi mạng giữ nguyên ván đó và chỉ `retry` mới gửi lại (máy chủ chặn ván trùng bằng mã ván (409) nên gửi lại không nhân đôi thưởng).
 * Khách chưa đăng nhập hoặc tài khoản khách theo thiết bị (`authed` = false): không gửi gì, nhưng ván vẫn được giữ và tự gửi khi họ đăng nhập xong ngay trên bảng điểm.
 */
export function useArcadeComplete(run: PlayedRun | null, authed: boolean) {
  const queryClient = useQueryClient();
  const [slot, setSlot] = useState<Slot | null>(null);
  const sentFor = useRef<PlayedRun | null>(null);
  const inFlight = useRef<PlayedRun | null>(null);

  const send = useCallback(
    async (r: PlayedRun) => {
      if (inFlight.current === r) return;
      inFlight.current = r;
      setSlot({ run: r, status: 'saving' });
      try {
        const runId = await r.runId;
        // Ván không có mã thì máy chủ cũng từ chối: báo luôn, khỏi gọi mạng và khỏi mời thử lại.
        if (runId === null) {
          setSlot((s) => (s?.run === r ? { run: r, status: 'invalid' } : s));
          return;
        }
        const result = await submitArcadeRun({ gameId: r.gameId, score: r.score, durationMs: r.durationMs, runId });
        // Ván mới bắt đầu trong lúc chờ: phản hồi cũ không được đè bảng điểm mới.
        setSlot((s) => (s?.run === r ? { run: r, status: 'saved', result } : s));
        // Giọt nước ở Vườn, lượt thưởng, và Điểm Xanh (hồ sơ, thẻ hội viên) đổi theo ván này.
        for (const queryKey of [['game'], ['me'], ['loyalty']]) void queryClient.invalidateQueries({ queryKey });
      } catch (error) {
        // 400 (mã thiếu, hết hạn hoặc điểm không hợp lệ) hoặc 409 ARCADE_RUN_USED: máy chủ từ chối chính ván này, gửi lại cùng mã vẫn bị từ chối nên không mời thử lại.
        // Mất mạng, 5xx và 409 tạm thời (hồ sơ đang cập nhật, xung đột giao dịch: mã chưa dùng) thì thử lại được.
        const replayed = isArcadeRunReplayed(error);
        const status = replayed ? 'replayed' : isArcadeRunRejected(error) ? 'invalid' : 'error';
        setSlot((s) => (s?.run === r ? { run: r, status } : s));
        // Mã đã dùng thường do lần gửi trước đã ghi nhưng phản hồi bị mất: làm mới Giọt nước (Vườn) và Điểm Xanh (hồ sơ, thẻ hội viên) để khớp máy chủ, đúng như câu báo.
        if (replayed) for (const queryKey of [['game'], ['me'], ['loyalty']]) void queryClient.invalidateQueries({ queryKey });
      } finally {
        if (inFlight.current === r) inFlight.current = null;
      }
    },
    [queryClient],
  );

  useEffect(() => {
    if (!run || !authed || sentFor.current === run) return;
    sentFor.current = run;
    void send(run);
  }, [run, authed, send]);

  const current = slot && slot.run === run ? slot : null;
  const retry = useCallback(() => {
    if (current?.status === 'error') void send(current.run);
  }, [current, send]);

  return { status: (current?.status ?? 'idle') as ArcadeSaveStatus, result: current?.result ?? null, retry };
}
