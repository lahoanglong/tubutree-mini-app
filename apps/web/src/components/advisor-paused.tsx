'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle, Phone } from 'lucide-react';
import { supportCopy } from '@tubutree/app-core/support-copy';
import { supportContactQuery } from '@tubutree/app-core/queries/config';
import { Heading, Text } from '@/components/mini';
import { coreHttp } from '@/lib/core-http';
import { ui } from '@/lib/guest-ui';
import { formatPhoneDisplay } from '@/lib/phone-display';
import { usePublicConfig } from '@/lib/use-public-config';

/** Khớp mặc định của API: lỗi đọc cấu hình thì khách vẫn còn số để gọi. */
const DEFAULT_HOTLINE = '0984 606 774';

/** Cờ AI tắt: thay vì đẩy thẳng về Trang chủ, nói rõ trợ lý đang nghỉ và chỉ đường hỏi người thật. */
export function AdvisorPaused() {
  const chatOn = usePublicConfig().chat?.enabled === true;
  const supportQ = useQuery({ ...supportContactQuery(coreHttp), staleTime: 10 * 60_000 });
  const hotline = supportQ.isError ? DEFAULT_HOTLINE : supportQ.data?.hotline ?? null;
  const copy = supportCopy.advisorPaused;

  return (
    <div data-testid="advisor-paused" className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <Heading variant="title-md">{copy.title}</Heading>
      <Text variant="body-md" tone="secondary">{copy.body}</Text>
      {chatOn ? (
        <Link href="/ho-tro/chat" className={`${ui.btnPrimary} mt-2 w-full max-md:min-h-12`}>
          <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />
          {copy.chat}
        </Link>
      ) : (
        hotline && (
          <a href={`tel:${hotline.replace(/[^\d+]/g, '')}`} className={`${ui.btnPrimary} mt-2 w-full max-md:min-h-12`}>
            <Phone className="mr-2 h-4 w-4" aria-hidden="true" />
            {copy.call(formatPhoneDisplay(hotline))}
          </a>
        )
      )}
      <Link href="/" className={`${ui.btnSecondary} w-full max-md:min-h-12`}>
        {copy.home}
      </Link>
    </div>
  );
}
