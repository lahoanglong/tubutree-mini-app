'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle, MessageSquare, Phone, Mail, type LucideIcon } from 'lucide-react';
import { supportContactQuery } from '@tubutree/app-core/queries/config';
import { Icon, Text } from '@/components/mini';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { formatPhoneDisplay } from '@/lib/phone-display';
import { platformBridge } from '@/lib/platform-bridge';
import { loginHref } from '@/lib/return-to';
import { usePublicConfig } from '@/lib/use-public-config';

/** Khớp mặc định của API: lỗi đọc cấu hình thì khách vẫn còn đường liên hệ. */
const DEFAULT_SUPPORT = { hotline: '0984 606 774', email: 'tubutree@gmail.com', zaloOaName: null };
const BTN = 'zaui-btn zaui-btn-tertiary zaui-btn-prefix-icon tubu-btn';
const BTN_STYLE = { minHeight: 44, borderRadius: 'var(--radius-control)', fontWeight: 600 } as const;

function Inner({ icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="zaui-btn-container">
      <span className="zaui-btn-icon">
        <Icon icon={icon} size="sm" tone="brand" />
      </span>
      <span>{children}</span>
    </div>
  );
}

function GhostLink({ href, icon, children }: { href: string; icon: LucideIcon; children: ReactNode }) {
  const external = href.startsWith('tel:') || href.startsWith('mailto:');
  const props = { className: BTN, style: BTN_STYLE };
  return external ? (
    <a href={href} {...props}>
      <Inner icon={icon}>{children}</Inner>
    </a>
  ) : (
    <Link href={href} {...props}>
      <Inner icon={icon}>{children}</Inner>
    </Link>
  );
}

/**
 * Khối "Cần hỗ trợ?" của chi tiết đơn và theo dõi yêu cầu đổi rác, cùng quy tắc với SupportContact của Mini App:
 * chat bật và đã đăng nhập → vào chat (kèm mã đơn); chưa đăng nhập → giữ OA/hotline và mời đăng nhập; đang khôi phục phiên → chỉ OA/hotline.
 * Email là liên kết mailto: (web không có snackbar "đã sao chép").
 */
export function SupportContact({ orderCode }: { orderCode?: string }) {
  const chatOn = usePublicConfig().chat?.enabled === true;
  const phase = useAuthPhase();
  const chatReady = chatOn && phase === 'authenticated';
  const supportQ = useQuery({ ...supportContactQuery(coreHttp), staleTime: 10 * 60_000 });
  const support = supportQ.isError ? DEFAULT_SUPPORT : supportQ.data;
  const hasOA = platformBridge.oa.available;
  const hotline = support?.hotline ?? null;
  const email = support?.email ?? null;
  if (!hasOA && !hotline && !email && !chatReady) return null;

  const chatPath = orderCode ? `/ho-tro/chat?order=${encodeURIComponent(orderCode)}` : '/ho-tro/chat';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <Text variant="caption" tone="tertiary">Cần hỗ trợ?</Text>
      {chatReady && (
        <GhostLink href={chatPath} icon={MessageCircle}>
          Chat với Tubu Tree
        </GhostLink>
      )}
      {!chatReady && hasOA && (
        <button type="button" className={BTN} style={BTN_STYLE} onClick={() => void platformBridge.oa.openChat(orderCode ? `Hỗ trợ đơn ${orderCode}` : undefined)}>
          <Inner icon={MessageSquare}>Nhắn Zalo OA</Inner>
        </button>
      )}
      {chatOn && phase === 'guest' && (
        <GhostLink href={loginHref(chatPath)} icon={MessageCircle}>
          Đăng nhập để chat với Tubu Tree
        </GhostLink>
      )}
      {hotline && (
        <GhostLink href={`tel:${hotline.replace(/[^\d+]/g, '')}`} icon={Phone}>
          {`Gọi hotline ${formatPhoneDisplay(hotline)}`}
        </GhostLink>
      )}
      {email && (
        <GhostLink href={`mailto:${email}`} icon={Mail}>
          {email}
        </GhostLink>
      )}
    </div>
  );
}
