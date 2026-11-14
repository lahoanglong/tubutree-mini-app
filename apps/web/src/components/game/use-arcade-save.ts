'use client';

import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { completeArcade, type ArcadeCompleteResult } from '@tubutree/app-core/api/game';
import type { ArcadeResult } from '@tubutree/app-core/arcade/arcade-canvas';
import { coreHttp } from '@/lib/core-http';

export type ArcadeSaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'done'; data: ArcadeCompleteResult }
  | { status: 'error' };

/**
 * Gửi kết quả một ván lên máy chủ ĐÚNG MỘT LẦN: `begin` gọi lại với cùng ván (render lại, Strict Mode, `onEnd` bắn hai lần) không gửi thêm,
 * `retry` chỉ chạy khi lần trước lỗi và gửi lại đúng ván đó.
 * `reset` bỏ ván đang giữ để ván mới gửi được; lời đáp muộn của ván cũ không ghi đè trạng thái ván mới nhưng vẫn làm mới số Giọt nước.
 */
export function useArcadeSave() {
  const qc = useQueryClient();
  const [state, setState] = useState<ArcadeSaveState>({ status: 'idle' });
  const run = useRef<ArcadeResult | null>(null);
  const sending = useRef<ArcadeResult | null>(null);
  const settled = useRef<ArcadeResult | null>(null);

  const send = useCallback(async () => {
    const r = run.current;
    if (!r || sending.current === r || settled.current === r) return;
    sending.current = r;
    setState({ status: 'saving' });
    try {
      const data = await completeArcade(coreHttp, { gameId: r.gameId, score: r.score, durationMs: r.durationMs });
      settled.current = r;
      for (const queryKey of [['game'], ['me'], ['loyalty']]) void qc.invalidateQueries({ queryKey });
      if (run.current === r) setState({ status: 'done', data });
    } catch {
      if (run.current === r) setState({ status: 'error' });
    } finally {
      if (sending.current === r) sending.current = null;
    }
  }, [qc]);

  const begin = useCallback(
    (r: ArcadeResult) => {
      if (run.current === r) return;
      run.current = r;
      void send();
    },
    [send],
  );
  const retry = useCallback(() => {
    if (state.status === 'error') void send();
  }, [send, state.status]);
  const reset = useCallback(() => {
    run.current = null;
    setState({ status: 'idle' });
  }, []);

  return { state, begin, retry, reset };
}
