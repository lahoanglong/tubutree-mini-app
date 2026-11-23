import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { ui } from '@/lib/guest-ui';
import { GUEST_ONLY_WHILE_RESTORING, RESTORING_ONLY } from '@/lib/restoring-swap';

export interface Crumb {
  label: string;
  /** Bỏ trống ở mục cuối (trang hiện tại). */
  href?: string;
}

/**
 * Link "← Trang trước" của trang con. Mini App không có link chữ này mà dùng nút lùi tròn nổi (layout gắn một lần cho mọi trang),
 * nên ở điện thoại (< md) link ẩn; từ md giữ nguyên link chữ. Có `crumbs` thì từ md thay link bằng đường dẫn "Trang chủ › Mục › Trang này"
 * (cho thấy trang nằm ở đâu và nhảy lên được nhiều cấp); không có thì vẫn là link lùi một cấp.
 */
export default function BackLink({ href, children, crumbs }: { href: string; children: ReactNode; crumbs?: Crumb[] }) {
  if (crumbs && crumbs.length > 0) {
    return (
      <nav aria-label="Đường dẫn" data-back-link="" className="max-md:hidden">
        <div className="flex flex-wrap items-center text-sm text-stone-600">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <span key={`${i}-${c.label}`} className="flex min-w-0 items-center">
                {c.href && !last ? (
                  <Link href={c.href} className="inline-flex min-h-11 items-center font-medium text-forest-700 hover:underline">
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current={last ? 'page' : undefined} className="max-w-[28rem] truncate">
                    {c.label}
                  </span>
                )}
                {!last && <ChevronRight className="mx-1 h-4 w-4 flex-none text-stone-500" aria-hidden="true" />}
              </span>
            );
          })}
        </div>
      </nav>
    );
  }
  return (
    <Link href={href} data-back-link="" className={`${ui.backLink} max-md:hidden`}>
      {children}
    </Link>
  );
}

export interface BackTarget {
  href: string;
  label: ReactNode;
}

/** Pha của link lùi khách/người đăng nhập: `restoring` là HTML máy chủ và lượt hydrate đầu của màn khách dựng sẵn (chưa biết pha thật). */
export type GuestMemberBackPhase = 'restoring' | 'guest' | 'member';

/**
 * Link lùi của trang có màn khách dựng sẵn (`PrebuiltGuest`): khách lùi về `guest`, người đã đăng nhập về `member`.
 *
 * Trước hydrate (`restoring`) có cả hai link: máy còn cờ phiên (<html data-restoring>, đặt trước khi vẽ) thì CSS giấu link khách và hiện link
 * của người đã đăng nhập (cùng kiểu, cao 44px), nên từ md người đã đăng nhập không thấy link khách chớp qua rồi đổi. Khách vãng lai không có
 * thuộc tính đó nên thấy ngay link khách. Sau hydrate chỉ còn link của pha thật.
 *
 * Hai ô bọc và link trong ô luôn ở đúng chỗ của nó qua mọi pha (không đổi qua lại giữa cặp link và một `BackLink` trần), nên React giữ nguyên
 * nút `<a>` đang hiện khi hydrate xong: người dùng bàn phím đã Tab tới link trước hydrate không bị rơi focus về <body>. Chỉ giữ được khi
 * pha mới vẫn vẽ cùng một khung trang; màn tự dựng khung riêng (vd bảng CTV `Dashboard`, `DealerHub`) thì React dựng lại link.
 */
export function GuestMemberBackLink({ guest, member, phase }: { guest: BackTarget; member: BackTarget; phase: GuestMemberBackPhase }) {
  const restoring = phase === 'restoring';
  return (
    <>
      <div className={restoring ? GUEST_ONLY_WHILE_RESTORING : undefined}>
        {phase !== 'member' && <BackLink href={guest.href}>{guest.label}</BackLink>}
      </div>
      <div className={restoring ? RESTORING_ONLY : undefined}>
        {phase !== 'guest' && <BackLink href={member.href}>{member.label}</BackLink>}
      </div>
    </>
  );
}
