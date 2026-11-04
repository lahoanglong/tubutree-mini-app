import { useEffect, useState } from 'react';
import { isChunkLoadError, reloadOnceForChunkError } from '@/lib/chunk-reload';
import { reportError, reportErrorSettled } from '@/lib/error-report';

export const CHUNK_UPDATED_TEXT = 'Trang vừa được cập nhật. Bấm Tải lại trang để tiếp tục.';
export const CHUNK_OFFLINE_TEXT = 'Mất kết nối. Có mạng lại thì bấm Tải lại trang.';

/** Chờ phản hồi tối đa ngần này khi dò mạng: Wi-Fi cổng đăng nhập hay không ra Internet thì không bao giờ trả lời. */
export const REACHABILITY_TIMEOUT_MS = 3_000;

type Phase = 'pending' | 'reloading' | 'offline' | 'stuck';

/**
 * Dùng chung cho mọi khung lỗi (app/error, SegmentError, global-error). Lỗi tải chunk thì tự tải lại một lần, chỉ khi còn mạng: mất mạng cũng ném
 * ChunkLoadError, tải lại lúc đó chỉ ra trang "không có mạng" của trình duyệt và khách mất trang. Lỗi thường: báo lỗi như trước.
 * `hold` = chưa nên vẽ gì (đang tải lại, hoặc chưa biết có tải lại không).
 */
/**
 * `navigator.onLine` là true cả trên Wi-Fi cổng đăng nhập hay mất Internet: tải lại lúc đó ra trang lỗi của trình duyệt. Hỏi thử chính trang này (cùng gốc, HEAD, không cache):
 * có phản hồi dưới 500 là tới được ứng dụng; lỗi mạng, quá hạn hay 5xx thì coi như chưa tải lại được.
 */
async function reachable(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REACHABILITY_TIMEOUT_MS);
  try {
    const res = await fetch('/', { method: 'HEAD', cache: 'no-store', signal: ctl.signal });
    // 5xx (nginx 502/503 lúc đổi container khi triển khai) là trang lỗi của proxy: tải lại chỉ ra đúng trang đó.
    return res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function useChunkRecovery(error: unknown): { chunkError: boolean; hold: boolean; message: string | null } {
  const chunkError = isChunkLoadError(error);
  const [phase, setPhase] = useState<Phase>('pending');
  useEffect(() => {
    if (!chunkError) {
      reportError(error);
      return;
    }
    let alive = true;
    void reachable().then((up) => {
      if (!alive) return;
      if (!up) {
        setPhase('offline');
        return;
      }
      if (reloadOnceForChunkError(Date.now(), () => reportErrorSettled(error))) {
        setPhase('reloading');
        return;
      }
      reportError(error);
      setPhase('stuck');
    });
    return () => {
      alive = false;
    };
  }, [error, chunkError]);
  if (!chunkError) return { chunkError: false, hold: false, message: null };
  if (phase === 'pending' || phase === 'reloading') return { chunkError: true, hold: true, message: null };
  return { chunkError: true, hold: false, message: phase === 'offline' ? CHUNK_OFFLINE_TEXT : CHUNK_UPDATED_TEXT };
}
