'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { ui } from '@/lib/guest-ui';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import BackLink from '@/components/back-link';

/** Khung chung của màn nhân sự: mỗi nhánh render có đúng một h1. */
export function StaffShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <BackLink href="/tai-khoan">
        ← Tài khoản
      </BackLink>
      <h1 className={`mt-1 ${ui.pageTitle}`}>{title}</h1>
      <div className="mt-4">{children}</div>
    </main>
  );
}

export const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');

/**
 * Cổng vào màn nhân sự: chưa đăng nhập, mất kết nối phiên, hoặc không phải STAFF/ADMIN thì dừng ở đây và không gọi API
 * nào; chỉ khi đủ quyền mới dựng `children` (nơi có các truy vấn).
 */
export function StaffGate({
  title,
  loginMessage,
  deniedMessage,
  returnTo,
  children,
}: {
  title: string;
  loginMessage: string;
  deniedMessage: string;
  returnTo: string;
  children: React.ReactNode;
}) {
  const phase = useAuthPhase();
  const { user } = useAuth();
  const role = user?.role;

  if (phase === 'loading' || (phase === 'authenticated' && !user)) {
    return (
      <StaffShell title={title}>
        <AuthLoading />
      </StaffShell>
    );
  }
  if (phase === 'unavailable') {
    return (
      <StaffShell title={title}>
        <SessionUnavailable />
      </StaffShell>
    );
  }
  if (phase === 'guest') {
    return (
      <StaffShell title={title}>
        <LoginRequired message={loginMessage} returnTo={returnTo} />
      </StaffShell>
    );
  }
  if (role !== 'STAFF' && role !== 'ADMIN') {
    return (
      <StaffShell title={title}>
        <p className="py-10 text-center text-stone-700">{deniedMessage}</p>
      </StaffShell>
    );
  }
  return <StaffShell title={title}>{children}</StaffShell>;
}

export interface Notice {
  text: string;
  tone: 'success' | 'info' | 'error';
}

/** Thông báo kết quả thao tác (web không có snackbar): thành công/thông tin là `status`, lỗi là `alert`. */
export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const node = notice ? (
    notice.tone === 'error' ? (
      <p role="alert" className={`rounded-control bg-danger-bg p-3 ${ui.error}`}>
        {notice.text}
      </p>
    ) : (
      <p role="status" className={`rounded-control p-3 text-sm font-medium ${notice.tone === 'success' ? 'bg-success-bg text-success-fg' : 'bg-info-bg text-info-fg'}`}>
        {notice.text}
      </p>
    )
  ) : null;
  return { node, notify: setNotice, clear: () => setNotice(null) };
}

/** Thanh chuyển kỳ (tuần/tháng): hai nút chỉ-icon 44px có tên và nhãn kỳ ở giữa, `aria-live` để đọc màn hình nghe được kỳ mới. */
export function PeriodNav({
  label,
  prevLabel,
  nextLabel,
  onPrev,
  onNext,
}: {
  label: string;
  prevLabel: string;
  nextLabel: string;
  onPrev: () => void;
  onNext: () => void;
}) {
  const btn = 'inline-flex h-11 w-11 items-center justify-center rounded-control text-stone-800 hover:bg-stone-50';
  return (
    <div className={`flex items-center justify-between px-1 ${ui.card}`}>
      <button type="button" aria-label={prevLabel} onClick={onPrev} className={btn}>
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </button>
      <div aria-live="polite" className="text-sm font-bold text-stone-900">
        {label}
      </div>
      <button type="button" aria-label={nextLabel} onClick={onNext} className={btn}>
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
}
