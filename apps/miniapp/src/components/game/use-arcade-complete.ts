import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ArcadeCompleteResult } from '@tubutree/app-core/api/game';
import type { ArcadeResult } from '@tubutree/app-core/arcade/arcade-canvas';
import { submitArcadeRun } from '../../services/arcade-api';

export type ArcadeSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface Slot {
  run: ArcadeResult;
  status: 'saving' | 'saved' | 'error';
  result?: ArcadeCompleteResult;
}

/**
 * Gửi kết quả MỘT ván đã đăng nhập lên máy chủ đúng một lần: theo đối tượng `run` (không theo lần vẽ), nên vẽ lại, Strict Mode hay `onEnd` bắn hai lần
 * không gửi thêm. Lỗi mạng giữ nguyên ván đó và chỉ `retry` mới gửi lại (máy chủ chặn ván trùng bằng TOO_FAST nên gửi lại không nhân đôi thưởng).
 * Khách chưa đăng nhập: không gửi gì, nhưng ván vẫn được giữ và tự gửi khi họ đăng nhập xong ngay trên bảng điểm.
 */
export function useArcadeComplete(run: ArcadeResult | null, authed: boolean) {
  const queryClient = useQueryClient();
  const [slot, setSlot] = useState<Slot | null>(null);
  const sentFor = useRef<ArcadeResult | null>(null);
  const inFlight = useRef<ArcadeResult | null>(null);

  const send = useCallback(
    async (r: ArcadeResult) => {
      if (inFlight.current === r) return;
      inFlight.current = r;
      setSlot({ run: r, status: 'saving' });
      try {
        const result = await submitArcadeRun({ gameId: r.gameId, score: r.score, durationMs: r.durationMs });
        // Ván mới bắt đầu trong lúc chờ: phản hồi cũ không được đè bảng điểm mới.
        setSlot((s) => (s?.run === r ? { run: r, status: 'saved', result } : s));
        // Số Giọt nước ở Vườn và trạng thái lượt thưởng đổi theo ván này.
        void queryClient.invalidateQueries({ queryKey: ['game'] });
      } catch {
        setSlot((s) => (s?.run === r ? { run: r, status: 'error' } : s));
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
