import BackLink from '@/components/back-link';
import { PartnerEarnNavPills } from '@/components/ui/ecosystem-nav-pills';
import { PageHeader } from '@/components/ui/page-header';
import { PAGE_WIDE } from '@/lib/page-frame';
import { loadErrorText } from '@/lib/error-text';

/** Khung chung của kênh đại lý: mỗi nhánh render có đúng một h1. */
export function DealerShell({
  title,
  guest = false,
  children,
}: {
  title: string;
  guest?: boolean;
  children: React.ReactNode;
}) {
  const backHref = guest ? '/' : '/tai-khoan';
  return (
    // Chân trang gọn (mt-8) nằm ngoài <main>; kéo nền xanh xám xuống sát nó để không lộ dải be ở điện thoại.
    <main className={`${PAGE_WIDE} py-6 max-md:-mb-8 max-md:min-h-dvh max-md:bg-[var(--color-dealer-bg)] max-md:pb-14`}
      data-dealer-theme
    >
      <BackLink href={backHref}>
        {guest ? '← Trang chủ' : '← Tài khoản'}
      </BackLink>
      <PageHeader title={title} parentHref={backHref} className="md:mt-1" />
      <div className="mt-3">
        <PartnerEarnNavPills />
      </div>
      <div className="mt-4">{children}</div>
    </main>
  );
}

export const errText = loadErrorText;
