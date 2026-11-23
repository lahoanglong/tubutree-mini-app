import { GuestMemberBackLink } from '@/components/back-link';
import { PartnerEarnNavPills } from '@/components/ui/ecosystem-nav-pills';
import { PageHeader } from '@/components/ui/page-header';
import { PAGE_WIDE } from '@/lib/page-frame';
import { loadErrorText } from '@/lib/error-text';

const GUEST_BACK = { href: '/', label: '← Trang chủ' } as const;
const MEMBER_BACK = { href: '/tai-khoan', label: '← Tài khoản' } as const;

/** Khung chung của kênh đại lý: mỗi nhánh render có đúng một h1. */
export function DealerShell({
  title,
  guest = false,
  restoring = false,
  children,
}: {
  title: string;
  guest?: boolean;
  /** Màn khách chưa hydrate (HTML máy chủ): máy còn cờ phiên thì link lùi đã là của người đăng nhập (`GuestMemberBackLink`). */
  restoring?: boolean;
  children: React.ReactNode;
}) {
  const backHref = guest ? GUEST_BACK.href : MEMBER_BACK.href;
  return (
    // Chân trang gọn (mt-8) nằm ngoài <main>; kéo nền xanh xám xuống sát nó để không lộ dải be ở điện thoại.
    <main className={`${PAGE_WIDE} py-6 max-md:-mb-8 max-md:min-h-dvh max-md:bg-[var(--color-dealer-bg)] max-md:pb-14`}
      data-dealer-theme
    >
      <GuestMemberBackLink guest={GUEST_BACK} member={MEMBER_BACK} phase={guest ? (restoring ? 'restoring' : 'guest') : 'member'} />
      <PageHeader title={title} parentHref={backHref} className="md:mt-1" />
      <div className="mt-3">
        <PartnerEarnNavPills />
      </div>
      <div className="mt-4">{children}</div>
    </main>
  );
}

export const errText = loadErrorText;
