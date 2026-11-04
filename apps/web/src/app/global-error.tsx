'use client';

import './globals.css';
import { ERROR_GENERIC } from '@tubutree/app-core/client-copy';
import { AlertTriangle } from 'lucide-react';
import { useChunkRecovery } from '@/lib/use-chunk-recovery';
import { ui } from '@/lib/guest-ui';

// Bắt lỗi ở CHÍNH root layout (Providers/SiteHeader throw) — error.tsx thường không phủ được
// trường hợp này vì nó nằm TRONG layout. Phải tự vẽ <html>/<body> vì layout gốc đã hỏng, và tự nạp globals.css
// (Tailwind + token) vì layout gốc không chạy nên trang lỗi sẽ không có kiểu nào nếu thiếu dòng import này.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { chunkError, hold, message } = useChunkRecovery(error);
  if (hold) {
    return (
      <html lang="vi">
        <body className="font-ui" />
      </html>
    );
  }
  return (
    <html lang="vi">
      <body className="font-ui">
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
      </body>
    </html>
  );
}
