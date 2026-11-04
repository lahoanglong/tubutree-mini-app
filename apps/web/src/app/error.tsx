'use client';

import { useEffect, useState } from 'react';
import { ERROR_GENERIC } from '@tubutree/app-core/client-copy';
import { AlertTriangle } from 'lucide-react';
import { isChunkLoadError, reloadOnceForChunkError } from '@/lib/chunk-reload';
import { reportError } from '@/lib/error-report';
import { ui } from '@/lib/guest-ui';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const chunkError = isChunkLoadError(error);
  // Lỗi chunk sau khi triển khai: tải lại một lần; đã tải lại rồi mà vẫn lỗi thì hiện nút "Tải lại trang" (reset không cứu được vì lời hứa lỗi được giữ lại).
  const [reloading, setReloading] = useState(false);
  useEffect(() => {
    if (chunkError && reloadOnceForChunkError()) {
      setReloading(true);
      return;
    }
    reportError(error);
  }, [error, chunkError]);
  if (reloading) return null;
  return (
    <main className="mx-auto max-w-3xl px-4 py-24 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-warning-bg text-warning-fg shadow-card">
        <AlertTriangle className="h-8 w-8" aria-hidden="true" />
      </div>
      <h1 className="mt-5 font-display text-2xl font-semibold text-stone-900">Có chút trục trặc</h1>
      <p className="mt-2 text-stone-700">{ERROR_GENERIC}</p>
      <button type="button" onClick={() => (chunkError ? location.reload() : reset())} className={`${ui.btnPrimary} mt-6`}>
        {chunkError ? 'Tải lại trang' : 'Thử lại'}
      </button>
    </main>
  );
}
