'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { ui } from '@/lib/guest-ui';
import { skin } from '@/components/pro-shared/mini-skin';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import BackLink from '@/components/back-link';
import { PageHeader } from '@/components/ui/page-header';
import { loadErrorText } from '@/lib/error-text';

// Chỉ nhánh bị từ chối quyền mới vẽ: nhân viên thật không phải tải minh hoạ này.
const EmptyState = dynamic(() => import('@/components/mini/empty-state').then((m) => m.EmptyState));

/**
 * Bố cục hai cột của Ca làm / Lương từ lg: cột bên 22rem (dính khi cuộn) và cột chính. Dưới lg các lớp bọc là `contents` nên các thẻ con
 * vẫn là con trực tiếp của khung flex như trước khi có cột: cùng thứ tự DOM, cùng khoảng cách 12px, giao diện điện thoại và máy tính bảng không đổi.
 * Thứ tự DOM = thứ tự đọc/Tab ở mọi khổ, nên mỗi màn chia hai cột theo đúng thứ tự thẻ đang có.
 */
export const staffLayout = {
  root: 'flex flex-col gap-3 pb-6 lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start lg:gap-x-6 lg:gap-y-3',
  /** Dòng thông báo kết quả nằm trên cả hai cột; rỗng thì bỏ hẳn khỏi lưới để không chừa khe 12px. */
  notice: 'lg:col-span-2 lg:empty:hidden',
  aside: 'contents lg:sticky lg:top-[calc(var(--header-h)+1rem)] lg:flex lg:flex-col lg:gap-3',
  main: 'contents lg:flex lg:min-w-0 lg:flex-col lg:gap-3',
  /** Cột chính còn là hộp flex thật ở mọi khổ (không `contents`): khi rỗng nó vẫn chiếm một khe 12px như bọc `grid gap-3` cũ của Lương. */
  mainBox: 'flex flex-col gap-3 lg:min-w-0',
} as const;

/**
 * Khung chung của màn nhân sự: mỗi nhánh render có đúng một h1. `wide` (Ca làm, Lương) nới khung từ lg lên bề rộng chuẩn của web
 * (`PAGE_WIDE`, 1200px) để đủ chỗ cho hai cột; không đặt thì giữ 1024px như cũ (màn Chủ thương hiệu dùng chung khung này).
 */
export function StaffShell({ title, wide = false, children }: { title: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <main className={`mx-auto max-w-5xl px-4 py-6${wide ? ' lg:max-w-frame lg:px-6' : ''}`}>
      <BackLink href="/tai-khoan">
        ← Tài khoản
      </BackLink>
      <PageHeader title={title} parentHref="/tai-khoan" className="md:mt-1" />
      <div className="mt-4">{children}</div>
    </main>
  );
}

export const errText = loadErrorText;

/**
 * Cổng vào màn nhân sự: chưa đăng nhập, mất kết nối phiên, hoặc không phải STAFF/ADMIN thì dừng ở đây và không gọi API
 * nào; chỉ khi đủ quyền mới dựng `children` (nơi có các truy vấn).
 */
export function StaffGate({
  title,
  loginMessage,
  returnTo,
  wide,
  children,
}: {
  title: string;
  loginMessage: string;
  returnTo: string;
  /** Khung rộng từ lg cho mọi nhánh (đang tải, từ chối, nội dung) để trang không đổi bề rộng khi quyền được xác nhận. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  const phase = useAuthPhase();
  const router = useRouter();
  const { user } = useAuth();
  const role = user?.role;

  if (phase === 'loading' || (phase === 'authenticated' && !user)) {
    return (
      <StaffShell title={title} wide={wide}>
        <AuthLoading />
      </StaffShell>
    );
  }
  if (phase === 'unavailable') {
    return (
      <StaffShell title={title} wide={wide}>
        <SessionUnavailable />
      </StaffShell>
    );
  }
  if (phase === 'guest') {
    return (
      <StaffShell title={title} wide={wide}>
        <LoginRequired message={loginMessage} returnTo={returnTo} />
      </StaffShell>
    );
  }
  if (role !== 'STAFF' && role !== 'ADMIN') {
    return (
      <StaffShell title={title} wide={wide}>
        <EmptyState
          art="leaf"
          heading="Trang dành cho nhân viên"
          body="Tài khoản này chưa có quyền nhân viên. Liên hệ quản trị để được cấp quyền."
          ctaLabel="Về Cá nhân"
          onCta={() => router.push('/tai-khoan')}
        />
      </StaffShell>
    );
  }
  return <StaffShell title={title} wide={wide}>{children}</StaffShell>;
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
    <div className={`flex items-center justify-between px-1 ${skin.card}`}>
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
