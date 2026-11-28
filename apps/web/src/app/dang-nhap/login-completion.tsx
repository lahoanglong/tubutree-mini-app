'use client';

import { AlertCircle } from 'lucide-react';
import { ui } from '@/lib/guest-ui';
import { loginHref, takeReturnTo } from '@/lib/return-to';

export interface LoginFailure {
  message: string;
  retryHref: string;
  transient: boolean;
}

/** Thất bại ở trang nhận mã (Zalo, Google): giữ nơi cần quay lại để "Đăng nhập lại" đưa khách về đúng chỗ sau lần thử kế tiếp. */
export function loginFailure(message: string, detail?: unknown, transient = false): LoginFailure {
  if (detail !== undefined) console.error('[dang-nhap] đăng nhập thất bại', detail);
  // Dấu khung chờ do script ở <head> đặt chỉ được AccountShell gỡ; đăng nhập hỏng rồi sang /tai-khoan thì dấu còn sót làm khung nháy một khung hình.
  document.documentElement.removeAttribute('data-restoring');
  return { message, retryHref: loginHref(takeReturnTo()), transient };
}

/** Màn chờ "Đang đăng nhập…" hoặc màn lỗi, dùng chung cho trang nhận mã Zalo và Google. */
export function LoginCompletionScreen({ failure }: { failure: LoginFailure | null }) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 py-10 text-center">
      {failure ? (
        <>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-danger-bg text-danger-fg shadow-card">
            <AlertCircle className="h-8 w-8" aria-hidden="true" />
          </div>
          <h1 className="mt-4 font-display text-xl font-semibold text-stone-900">Đăng nhập chưa thành công</h1>
          <p role="alert" className={`mt-2 font-medium ${ui.error}`}>
            {failure.message}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <a href={failure.retryHref} className={ui.btnPrimary}>
              {failure.transient ? 'Thử lại' : 'Đăng nhập lại'}
            </a>
            {/* Tải lại hẳn trang: trao đổi mã lỗi để trạng thái đăng nhập ở 'idle'; tải lại mới khôi phục phiên cookie còn hạn. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className={ui.btnSecondary}>
              Về trang chủ
            </a>
          </div>
        </>
      ) : (
        <>
          <div
            aria-hidden="true"
            className="h-10 w-10 animate-spin rounded-full border-4 border-forest-200 border-t-forest-600"
          />
          <h1 className="mt-4 text-base font-normal text-stone-700">
            Đang đăng nhập…
          </h1>
        </>
      )}
    </main>
  );
}
