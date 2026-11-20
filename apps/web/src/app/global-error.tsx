'use client';

import './globals.css';
import { ErrorScreen } from '@/components/error-screen';

// Bắt lỗi ở CHÍNH root layout (Providers/SiteHeader throw) — error.tsx thường không phủ được
// trường hợp này vì nó nằm TRONG layout. Phải tự vẽ <html>/<body> vì layout gốc đã hỏng, và tự nạp globals.css
// (Tailwind + token) vì layout gốc không chạy nên trang lỗi sẽ không có kiểu nào nếu thiếu dòng import này.
// Lúc chưa biết có tự tải lại không (`hold`), ErrorScreen không vẽ gì nên thân trang rỗng.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="vi">
      <body className="font-ui">
        <ErrorScreen error={error} reset={reset} />
      </body>
    </html>
  );
}
