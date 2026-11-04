'use client';

import { ERROR_GENERIC } from '@tubutree/app-core/client-copy';
import { AlertTriangle } from 'lucide-react';
import { useChunkRecovery } from '@/lib/use-chunk-recovery';
import { ui } from '@/lib/guest-ui';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Lỗi chunk: tải lại một lần nếu còn mạng; không thì hiện nút "Tải lại trang" (reset không cứu được vì lời hứa lỗi được giữ lại).
  const { chunkError, hold, message } = useChunkRecovery(error);
  if (hold) return null;
  return (
    <main className="mx-auto max-w-3xl px-4 py-24 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-warning-bg text-warning-fg shadow-card">
        <AlertTriangle className="h-8 w-8" aria-hidden="true" />
      </div>
      <h1 className="mt-5 font-display text-2xl font-semibold text-stone-900">Có chút trục trặc</h1>
      <p className="mt-2 text-stone-700">{message ?? ERROR_GENERIC}</p>
      <button type="button" onClick={() => (chunkError ? location.reload() : reset())} className={`${ui.btnPrimary} mt-6`}>
        {chunkError ? 'Tải lại trang' : 'Thử lại'}
      </button>
    </main>
  );
}
