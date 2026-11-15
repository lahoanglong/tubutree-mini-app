import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isArcadeRunRejected, isArcadeRunReplayed, type ArcadeCompleteResult } from '@tubutree/app-core/api/game';
import type { ArcadeResult } from '@tubutree/app-core/arcade/arcade-canvas';
import { submitArcadeRun } from '../../services/arcade-api';

export type ArcadeSaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'invalid';

/** Ván đã chơi xong kèm mã ván lấy lúc bấm Chơi; `null` khi chưa xin được mã (lỗi mạng ở bước xin, hoặc ván kết thúc trước khi mã về). */
export type PlayedRun = ArcadeResult & { runId: string | null };

interface Slot {
  run: PlayedRun;
  status: 'saving' | 'saved' | 'error' | 'invalid';
  result?: ArcadeCompleteResult;
}

/**
 * Gửi kết quả MỘT ván đã đăng nhập lên máy chủ đúng một lần: theo đối tượng `run` (không theo lần vẽ), nên vẽ lại, Strict Mode hay `onEnd` bắn hai lần
 * không gửi thêm. Lỗi mạng giữ nguyên ván đó và chỉ `retry` mới gửi lại (máy chủ chặn ván trùng bằng mã ván (409) nên gửi lại không nhân đôi thưởng).
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
      const runId = r.runId;
      // Ván không có mã thì máy chủ cũng từ chối: báo luôn, khỏi gọi mạng và khỏi mời thử lại.
      if (runId === null) {
        setSlot({ run: r, status: 'invalid' });
        return;
      }
      inFlight.current = r;
      setSlot({ run: r, status: 'saving' });
      try {
        const result = await submitArcadeRun({ gameId: r.gameId, score: r.score, durationMs: r.durationMs, runId });
        // Ván mới bắt đầu trong lúc chờ: phản hồi cũ không được đè bảng điểm mới.
        setSlot((s) => (s?.run === r ? { run: r, status: 'saved', result } : s));
        // Số Giọt nước ở Vườn và trạng thái lượt thưởng đổi theo ván này.
        void queryClient.invalidateQueries({ queryKey: ['game'] });
      } catch (error) {
        // 400 hoặc 409 ARCADE_RUN_USED: máy chủ từ chối chính ván này (mã thiếu, hết hạn, đã dùng hoặc điểm không hợp lệ), gửi lại cùng mã vẫn bị từ chối nên không mời thử lại.
        // Mất mạng, 5xx và 409 tạm thời (hồ sơ đang cập nhật, xung đột giao dịch: mã chưa dùng) thì thử lại được.
        const status = isArcadeRunRejected(error) ? 'invalid' : 'error';
        setSlot((s) => (s?.run === r ? { run: r, status } : s));
        // Mã đã dùng có thể do lần gửi trước đã ghi nhưng phản hồi bị mất: làm mới để Giọt nước ở Vườn khớp máy chủ.
        if (isArcadeRunReplayed(error)) void queryClient.invalidateQueries({ queryKey: ['game'] });
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
