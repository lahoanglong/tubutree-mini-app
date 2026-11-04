import { useEffect, useState } from 'react';
import { isChunkLoadError, reloadOnceForChunkError } from '@/lib/chunk-reload';
import { reportError } from '@/lib/error-report';

export const CHUNK_UPDATED_TEXT = 'Trang vừa được cập nhật. Bấm Tải lại trang để tiếp tục.';
export const CHUNK_OFFLINE_TEXT = 'Mất kết nối. Có mạng lại thì bấm Tải lại trang.';

type Phase = 'pending' | 'reloading' | 'offline' | 'stuck';

/**
 * Dùng chung cho mọi khung lỗi (app/error, SegmentError, global-error). Lỗi tải chunk thì tự tải lại một lần, chỉ khi còn mạng: mất mạng cũng ném
 * ChunkLoadError, tải lại lúc đó chỉ ra trang "không có mạng" của trình duyệt và khách mất trang. Lỗi thường: báo lỗi như trước.
 * `hold` = chưa nên vẽ gì (đang tải lại, hoặc chưa biết có tải lại không).
 */
export function useChunkRecovery(error: unknown): { chunkError: boolean; hold: boolean; message: string | null } {
  const chunkError = isChunkLoadError(error);
  const [phase, setPhase] = useState<Phase>('pending');
  useEffect(() => {
    if (!chunkError) {
      reportError(error);
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setPhase('offline');
      return;
    }
    if (reloadOnceForChunkError(Date.now(), () => reportError(error))) {
      setPhase('reloading');
      return;
    }
    reportError(error);
    setPhase('stuck');
  }, [error, chunkError]);
  if (!chunkError) return { chunkError: false, hold: false, message: null };
  if (phase === 'pending' || phase === 'reloading') return { chunkError: true, hold: true, message: null };
  return { chunkError: true, hold: false, message: phase === 'offline' ? CHUNK_OFFLINE_TEXT : CHUNK_UPDATED_TEXT };
}
