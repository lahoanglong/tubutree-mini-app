'use client';

import { AlertTriangle } from 'lucide-react';

// Bắt lỗi ở CHÍNH root layout (Providers/SiteHeader throw) — error.tsx thường không phủ được
// trường hợp này vì nó nằm TRONG layout. Phải tự vẽ <html>/<body> vì layout gốc đã hỏng.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="vi">
      <body className="font-sans">
        <main className="mx-auto max-w-3xl px-4 py-24 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 shadow-sm ring-8 ring-amber-50/50">
            <AlertTriangle className="h-8 w-8 text-amber-600" />
          </div>
          <h1 className="mt-5 text-2xl font-bold text-neutral-900">Có chút trục trặc</h1>
          <p className="mt-2 text-neutral-600">Đã có lỗi xảy ra. Vui lòng thử lại.</p>
          <button
            onClick={() => reset()}
            className="mt-6 rounded-full bg-primary-600 px-6 py-2.5 font-semibold text-white shadow-sm hover:bg-primary-700 transition"
          >
            Thử lại
          </button>
        </main>
      </body>
    </html>
  );
}
