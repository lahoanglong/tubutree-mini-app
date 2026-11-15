'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { completeArcade, isArcadeRunRejected, isArcadeRunReplayed, type ArcadeCompleteResult } from '@tubutree/app-core/api/game';
import type { ArcadeResult } from '@tubutree/app-core/arcade/arcade-canvas';
import { coreHttp } from '@/lib/core-http';
import { clearPendingArcade, rememberPendingArcade, takePendingArcade, type ArcadeRunTicket, type PendingArcade } from './arcade-pending';

/**
 * Vì sao lưu ván lỗi: `invalid` = máy chủ từ chối chính ván này (400), gửi lại cùng mã cũng vậy nên không mời thử lại; `replayed` = 409 mã ván đã dùng,
 * thường là lần gửi trước đã ghi mà phản hồi bị mất (không phải lỗi của khách, cũng không mời thử lại); `retry` = lỗi mạng, 5xx và 409 tạm thời: thử lại được.
 */
export type ArcadeSaveErrorKind = 'invalid' | 'replayed' | 'retry';

const errorKind = (e: unknown): ArcadeSaveErrorKind => (isArcadeRunReplayed(e) ? 'replayed' : isArcadeRunRejected(e) ? 'invalid' : 'retry');

/** Mã ván của một ván: `null` khi `arcade-start` không tới được máy chủ. Không bao giờ reject. */
export type ArcadeTicketPromise = Promise<ArcadeRunTicket | null>;

const refreshAfterSave = (qc: QueryClient) => {
  for (const queryKey of [['game'], ['me'], ['loyalty']]) void qc.invalidateQueries({ queryKey });
};

export type ArcadeSaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'done'; data: ArcadeCompleteResult }
  | { status: 'error'; kind: ArcadeSaveErrorKind };

/**
 * Gửi kết quả một ván lên máy chủ ĐÚNG MỘT LẦN: `begin` gọi lại với cùng ván (render lại, Strict Mode, `onEnd` bắn hai lần) không gửi thêm,
 * `retry` chỉ chạy khi lần trước lỗi tạm và gửi lại đúng ván đó cùng mã ván.
 * `begin` nhận PROMISE mã ván xin lúc bấm Chơi: lời đáp `arcade-start` có thể về sau lúc ván kết thúc, nên chờ nó ở đây (trạng thái `saving`, không nháy lỗi)
 * rồi mới gửi. Ván không xin được mã (`null`) không gọi mạng: máy chủ chắc chắn từ chối, nên báo luôn là không hợp lệ.
 * `reset` bỏ ván đang giữ để ván mới gửi được; lời đáp muộn của ván cũ không ghi đè trạng thái ván mới nhưng vẫn làm mới số Giọt nước.
 */
export function useArcadeSave() {
  const qc = useQueryClient();
  const [state, setState] = useState<ArcadeSaveState>({ status: 'idle' });
  const run = useRef<ArcadeResult | null>(null);
  const ticket = useRef<ArcadeTicketPromise>(Promise.resolve(null));
  const sending = useRef<ArcadeResult | null>(null);
  const settled = useRef<ArcadeResult | null>(null);

  const send = useCallback(async () => {
    const r = run.current;
    if (!r || sending.current === r || settled.current === r) return;
    const ticketOfRun = ticket.current;
    sending.current = r;
    setState({ status: 'saving' });
    try {
      const t = await ticketOfRun;
      if (t === null) {
        settled.current = r;
        if (run.current === r) setState({ status: 'error', kind: 'invalid' });
        return;
      }
      const data = await completeArcade(coreHttp, { gameId: r.gameId, score: r.score, durationMs: r.durationMs, runId: t.runId });
      settled.current = r;
      refreshAfterSave(qc);
      if (run.current === r) setState({ status: 'done', data });
    } catch (e) {
      const kind = errorKind(e);
      if (kind !== 'retry') settled.current = r;
      if (kind === 'replayed') refreshAfterSave(qc);
      if (run.current === r) setState({ status: 'error', kind });
    } finally {
      if (sending.current === r) sending.current = null;
    }
  }, [qc]);

  const begin = useCallback(
    (r: ArcadeResult, ticketOfRun: ArcadeTicketPromise) => {
      if (run.current === r) return;
      run.current = r;
      ticket.current = ticketOfRun;
      void send();
    },
    [send],
  );
  const retry = useCallback(() => {
    if (state.status === 'error' && state.kind === 'retry') void send();
  }, [send, state]);
  const reset = useCallback(() => {
    run.current = null;
    ticket.current = Promise.resolve(null);
    setState({ status: 'idle' });
  }, []);

  return { state, begin, retry, reset };
}

export type PendingSaveState =
  | { status: 'idle' }
  | { status: 'saving'; run: PendingArcade }
  | { status: 'done'; run: PendingArcade; data: ArcadeCompleteResult }
  | { status: 'error'; run: PendingArcade; kind: ArcadeSaveErrorKind };

/**
 * Gửi nốt ván khách đã chơi trước khi bấm "Đăng nhập lưu kỷ lục" (`rememberPendingArcade`), ngay khi phiên đã là phiên đăng nhập thật.
 * Khoá chờ bị xoá TRƯỚC khi gửi và `taken` giữ qua lần chạy lại của Strict Mode, nên mỗi ván được gửi đúng một lần; ván quá hạn của mã ván (tính từ lúc máy chủ cấp mã) bị bỏ và xoá.
 * Lỗi mạng hay 5xx: ghi lại khoá chờ (lần mở sảnh sau còn gửi tiếp nếu chưa quá hạn) và cho `retry`; HTTP 400 hay 409 mã đã dùng thì bỏ hẳn ván.
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
        const kind = errorKind(e);
        if (kind === 'retry') rememberPendingArcade(run);
        else current.current = null;
        if (kind === 'replayed') refreshAfterSave(qc);
        setState({ status: 'error', run, kind });
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
