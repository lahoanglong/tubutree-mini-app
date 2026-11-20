'use client';

import { ERROR_GENERIC } from '@tubutree/app-core/error-generic';
import { useChunkRecovery } from '@/lib/use-chunk-recovery';
import { BTN_PRIMARY } from '@/lib/btn-primary';
import { TriangleAlertIcon } from '@/components/triangle-alert-icon';

/**
 * Thân trang lỗi của app/error.tsx và app/global-error.tsx. Hai khung lỗi gốc nằm trong JS tải lần đầu của MỌI trang và mỗi khung là một chunk riêng
 * (webpack chép mô-đun dùng chung nhỏ hơn ngưỡng tách chunk vào từng chunk), nên tệp này chỉ nhập mô-đun nhỏ: câu lỗi từ `error-generic` (không
 * phải cả `client-copy`), lớp nút từ `btn-primary` (không phải cả bảng `ui`), icon vẽ sẵn thay cho lucide.
 */
export function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Lỗi chunk: tải lại một lần nếu còn mạng; không thì hiện nút "Tải lại trang" (reset không cứu được vì lời hứa lỗi được giữ lại).
  const { chunkError, hold, message } = useChunkRecovery(error);
  if (hold) return null;
  return (
    <main className="mx-auto max-w-3xl px-4 py-24 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-warning-bg text-warning-fg shadow-card">
        <TriangleAlertIcon />
      </div>
      <h1 className="mt-5 font-display text-2xl font-semibold text-stone-900">Có chút trục trặc</h1>
      <p className="mt-2 text-stone-700">{message ?? ERROR_GENERIC}</p>
      <button type="button" onClick={() => (chunkError ? location.reload() : reset())} className={`${BTN_PRIMARY} mt-6`}>
        {chunkError ? 'Tải lại trang' : 'Thử lại'}
      </button>
    </main>
  );
}
