import Link from 'next/link';
import { LogIn } from 'lucide-react';
import { loginHref } from '@/lib/return-to';
import { ui } from '@/lib/guest-ui';

/** Khối "cần đăng nhập" dùng chung cho giỏ hàng, thanh toán, tài khoản, chi tiết đơn. */
export function LoginRequired({ message, returnTo }: { message: string; returnTo: string }) {
  return (
    <div className="py-16 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-forest-50 text-forest-600 shadow-card">
        <LogIn className="h-8 w-8 stroke-[1.5]" aria-hidden="true" />
      </div>
      <p className="mx-auto mt-4 max-w-sm text-stone-700">{message}</p>
      <Link href={loginHref(returnTo)} className={`${ui.btnPrimary} mt-4`}>
        Đăng nhập với Zalo
      </Link>
      <p className="mx-auto mt-3 max-w-sm text-xs text-stone-600">Đăng nhập xong bạn sẽ quay lại đúng trang này.</p>
    </div>
  );
}

/** Đang khôi phục phiên đăng nhập — ngắn, chỉ ở lần mở trang đầu. */
export function AuthLoading() {
  return (
    <div className="py-20 text-center">
      <p className="text-stone-600">Đang tải…</p>
    </div>
  );
}
