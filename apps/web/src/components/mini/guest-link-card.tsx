'use client';

// Nguồn: apps/miniapp/src/components/home/guest-link-card.tsx. Web chỉ có một đối tượng: người chưa đăng nhập (không có tài khoản khách chưa liên kết Zalo);
// nút là liên kết tới trang đăng nhập, đăng nhập xong quay lại đúng trang này.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthPhase } from '@/lib/auth-phase';
import { ui } from '@/lib/guest-ui';
import { loginHref } from '@/lib/return-to';
import { Card } from './card';
import { Heading, Text } from './text';

/** Thẻ mời đăng nhập ở khối cần tài khoản. Đã đăng nhập, đang khôi phục phiên hay mất mạng (`loading`, `unavailable`) thì không vẽ: người đó có thể đang có phiên. */
export function GuestLinkCard({ title, body, cta }: { title: string; body: string; cta: string }) {
  const phase = useAuthPhase();
  const pathname = usePathname();
  if (phase !== 'guest') return null;
  return (
    <section aria-label={title}>
      <Card variant="flat" padding={16}>
        <Heading variant="title-sm" as="h2" font="ui">
          {title}
        </Heading>
        <Text variant="body-sm" tone="secondary" as="p" style={{ marginTop: 4 }}>
          {body}
        </Text>
        <div style={{ marginTop: 12 }}>
          <Link href={loginHref(pathname)} className={ui.btnPrimary}>
            {cta}
          </Link>
        </div>
      </Card>
    </section>
  );
}
