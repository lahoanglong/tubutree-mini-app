'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { errorStatus } from '@tubutree/app-core/api/error-status';
import { completeArcade, type ArcadeCompleteResult } from '@tubutree/app-core/api/game';
import type { ArcadeResult } from '@tubutree/app-core/arcade/arcade-canvas';
import { coreHttp } from '@/lib/core-http';
import { clearPendingArcade, rememberPendingArcade, takePendingArcade, type PendingArcade } from './arcade-pending';

/**
 * Máy chủ từ chối chính ván này: 400 (điểm hay mã ván không hợp lệ) hoặc 409 (mã ván đã dùng, hay ván bắt đầu trước khi ván trước xong).
 * Gửi lại cùng mã cũng vậy, nên không mời thử lại. Lỗi mạng và 5xx thì có.
 */
const isInvalidRun = (e: unknown) => {
  const status = errorStatus(e);
  return status === 400 || status === 409;
};

const refreshAfterSave = (qc: QueryClient) => {
  for (const queryKey of [['game'], ['me'], ['loyalty']]) void qc.invalidateQueries({ queryKey });
};

/** 409 thường là lần gửi trước đã ghi mà phản hồi bị mất: làm mới Giọt nước và Điểm Xanh để khách thấy đúng số. */
const refreshIfReplayed = (qc: QueryClient, e: unknown) => {
  if (errorStatus(e) === 409) refreshAfterSave(qc);
};

export type ArcadeSaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'done'; data: ArcadeCompleteResult }
  | { status: 'error'; invalid: boolean };

/**
 * Gửi kết quả một ván lên máy chủ ĐÚNG MỘT LẦN: `begin` gọi lại với cùng ván (render lại, Strict Mode, `onEnd` bắn hai lần) không gửi thêm,
 * `retry` chỉ chạy khi lần trước lỗi và gửi lại đúng ván đó cùng mã ván. Ván không có mã (lúc bấm Chơi không xin được `arcade-start`) không gọi
 * mạng: máy chủ chắc chắn từ chối, nên báo luôn là không hợp lệ.
 * `reset` bỏ ván đang giữ để ván mới gửi được; lời đáp muộn của ván cũ không ghi đè trạng thái ván mới nhưng vẫn làm mới số Giọt nước.
 */
export function useArcadeSave() {
  const qc = useQueryClient();
  const [state, setState] = useState<ArcadeSaveState>({ status: 'idle' });
  const run = useRef<ArcadeResult | null>(null);
  const runId = useRef<string | null>(null);
  const sending = useRef<ArcadeResult | null>(null);
  const settled = useRef<ArcadeResult | null>(null);

  const send = useCallback(async () => {
    const r = run.current;
    if (!r || sending.current === r || settled.current === r) return;
    const id = runId.current;
    if (id === null) {
      settled.current = r;
      setState({ status: 'error', invalid: true });
      return;
    }
    sending.current = r;
    setState({ status: 'saving' });
    try {
      const data = await completeArcade(coreHttp, { gameId: r.gameId, score: r.score, durationMs: r.durationMs, runId: id });
      settled.current = r;
      refreshAfterSave(qc);
      if (run.current === r) setState({ status: 'done', data });
    } catch (e) {
      const invalid = isInvalidRun(e);
      if (invalid) {
        settled.current = r;
        refreshIfReplayed(qc, e);
      }
      if (run.current === r) setState({ status: 'error', invalid });
    } finally {
      if (sending.current === r) sending.current = null;
    }
  }, [qc]);

  const begin = useCallback(
    (r: ArcadeResult, id: string | null) => {
      if (run.current === r) return;
      run.current = r;
      runId.current = id;
      void send();
    },
    [send],
  );
  const retry = useCallback(() => {
    if (state.status === 'error' && !state.invalid) void send();
  }, [send, state]);
  const reset = useCallback(() => {
    run.current = null;
    runId.current = null;
    setState({ status: 'idle' });
  }, []);

  return { state, begin, retry, reset };
}

export type PendingSaveState =
  | { status: 'idle' }
  | { status: 'saving'; run: PendingArcade }
  | { status: 'done'; run: PendingArcade; data: ArcadeCompleteResult }
  | { status: 'error'; run: PendingArcade; invalid: boolean };

/**
 * Gửi nốt ván khách đã chơi trước khi bấm "Đăng nhập lưu kỷ lục" (`rememberPendingArcade`), ngay khi phiên đã là phiên đăng nhập thật.
 * Khoá chờ bị xoá TRƯỚC khi gửi và `taken` giữ qua lần chạy lại của Strict Mode, nên mỗi ván được gửi đúng một lần; ván quá 10 phút bị bỏ và xoá.
 * Lỗi mạng hay 5xx: ghi lại khoá chờ (lần mở sảnh sau còn gửi tiếp nếu chưa quá hạn) và cho `retry`; HTTP 400 hay 409 thì bỏ hẳn ván.
 */
export function usePendingArcadeSave(enabled: boolean) {
  const qc = useQueryClient();
  const [state, setState] = useState<PendingSaveState>({ status: 'idle' });
  const taken = useRef(false);
  const sending = useRef(false);
  const current = useRef<PendingArcade | null>(null);

  const send = useCallback(
    async (run: PendingArcade) => {
      if (sending.current) return;
      sending.current = true;
      current.current = run;
      setState({ status: 'saving', run });
      try {
        const data = await completeArcade(coreHttp, { gameId: run.gameId, score: run.score, durationMs: run.durationMs, runId: run.runId });
        refreshAfterSave(qc);
        current.current = null;
        setState({ status: 'done', run, data });
      } catch (e) {
        const invalid = isInvalidRun(e);
        if (invalid) {
          current.current = null;
          refreshIfReplayed(qc, e);
        } else rememberPendingArcade(run);
        setState({ status: 'error', run, invalid });
      } finally {
        sending.current = false;
      }
    },
    [qc],
  );

  useEffect(() => {
    if (!enabled || taken.current) return;
    taken.current = true;
    const run = takePendingArcade();
    if (run) void send(run);
  }, [enabled, send]);

  const retry = useCallback(() => {
    const run = current.current;
    if (!run || sending.current) return;
    clearPendingArcade();
    void send(run);
  }, [send]);

  return { state, retry };
}
