'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle, MessageSquare, Phone, Mail, type LucideIcon } from 'lucide-react';
import { supportContactQuery } from '@tubutree/app-core/queries/config';
import { fillCopy } from '@tubutree/app-core/shop-copy';
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

function GhostLink({ href, icon, numeric = false, children }: { href: string; icon: LucideIcon; numeric?: boolean; children: ReactNode }) {
  const external = href.startsWith('tel:') || href.startsWith('mailto:');
  const props = { className: BTN, style: numeric ? { ...BTN_STYLE, fontVariantNumeric: 'tabular-nums' as const } : BTN_STYLE };
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

/** Mail tới CSKH: có mã đơn thì ghi sẵn ở tiêu đề thư để nhân viên khỏi hỏi lại. */
function mailtoHref(email: string, orderCode?: string): string {
  return orderCode ? `mailto:${email}?subject=${encodeURIComponent(fillCopy('support.orderContext', { code: orderCode }))}` : `mailto:${email}`;
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
  const titleId = useId();
  // Khoá đồng bộ: state `openingOa` chỉ đổi sau lần vẽ kế nên hai cú bấm cùng một nhịp sẽ mở OA hai lần; ref chặn được chuyện đó.
  // `openChat` trên web xong ngay trong microtask, nên hai cú bấm cách nhau một tác vụ vẫn là hai lần mở như trước.
  const openingOaRef = useRef(false);
  const [openingOa, setOpeningOa] = useState(false);
  const supportQ = useQuery({ ...supportContactQuery(coreHttp), staleTime: 10 * 60_000 });
  const support = supportQ.isError ? DEFAULT_SUPPORT : supportQ.data;
  const hasOA = platformBridge.oa.available;
  const hotline = support?.hotline ?? null;
  const email = support?.email ?? null;
  if (!hasOA && !hotline && !email && !chatReady) return null;

  const openOa = async () => {
    if (openingOaRef.current) return;
    openingOaRef.current = true;
    setOpeningOa(true);
    try {
      await platformBridge.oa.openChat(orderCode ? fillCopy('support.orderContext', { code: orderCode }) : undefined);
    } finally {
      openingOaRef.current = false;
      setOpeningOa(false);
    }
  };

  const chatPath = orderCode ? `/ho-tro/chat?order=${encodeURIComponent(orderCode)}` : '/ho-tro/chat';
  return (
    <div role="region" aria-labelledby={titleId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      {/* Text chuyển prop còn lại xuống thẻ nhưng TextProps chưa khai `id`; spec "vùng có tên" giữ cho id này không rơi mất. */}
      <Text variant="caption" tone="tertiary" {...{ id: titleId }}>
        {fillCopy('support.title')}
      </Text>
      {chatReady && (
        <GhostLink href={chatPath} icon={MessageCircle}>
          {fillCopy('support.chat')}
        </GhostLink>
      )}
      {!chatReady && hasOA && (
        <button type="button" className={BTN} style={BTN_STYLE} aria-busy={openingOa || undefined} onClick={() => void openOa()}>
          <Inner icon={MessageSquare}>{fillCopy('support.oa')}</Inner>
        </button>
      )}
      {chatOn && phase === 'guest' && (
        <GhostLink href={loginHref(chatPath)} icon={MessageCircle}>
          {fillCopy('support.chatLogin')}
        </GhostLink>
      )}
      {hotline && (
        <GhostLink href={`tel:${hotline.replace(/[^\d+]/g, '')}`} icon={Phone} numeric>
          {fillCopy('support.hotline', { phone: formatPhoneDisplay(hotline) })}
        </GhostLink>
      )}
      {email && (
        <GhostLink href={mailtoHref(email, orderCode)} icon={Mail}>
          {email}
        </GhostLink>
      )}
    </div>
  );
}
