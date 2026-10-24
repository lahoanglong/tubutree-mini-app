'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { reportError } from '@/lib/error-report';
import { ui } from '@/lib/guest-ui';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportError(error), [error]);
  return (
    <main className="mx-auto max-w-3xl px-4 py-24 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-warning-bg text-warning-fg shadow-card">
        <AlertTriangle className="h-8 w-8" aria-hidden="true" />
      </div>
      <h1 className="mt-5 font-display text-2xl font-semibold text-stone-900">Có chút trục trặc</h1>
      <p className="mt-2 text-stone-700">Đã có lỗi xảy ra khi tải trang. Vui lòng thử lại.</p>
      <button type="button" onClick={() => reset()} className={`${ui.btnPrimary} mt-6`}>
        Thử lại
      </button>
    </main>
  );
}
