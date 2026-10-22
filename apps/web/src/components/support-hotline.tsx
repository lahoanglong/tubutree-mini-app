'use client';

import { useQuery } from '@tanstack/react-query';
import { Phone } from 'lucide-react';
import { supportContactQuery } from '@tubutree/app-core/queries/config';
import { coreHttp } from '@/lib/core-http';
import { formatPhoneDisplay } from '@/lib/phone-display';

/** Khớp mặc định của API: lỗi đọc cấu hình thì màn lỗi vẫn còn đường liên hệ. */
const DEFAULT_HOTLINE = '0984 606 774';

/** "Cần hỗ trợ? Gọi <hotline>" cho màn lỗi, như SupportHotline của Mini App; hotline đọc từ cấu hình công khai. */
export function SupportHotline() {
  const q = useQuery({ ...supportContactQuery(coreHttp), staleTime: 10 * 60_000 });
  const hotline = q.isError ? DEFAULT_HOTLINE : q.data?.hotline;
  if (!hotline) return null;
  return (
    <p className="flex flex-wrap items-center justify-center gap-1 text-sm text-stone-600">
      <span>Cần hỗ trợ?</span>
      <a href={`tel:${hotline.replace(/[^\d+]/g, '')}`} className="inline-flex min-h-11 items-center gap-1 px-2 font-semibold text-forest-700 underline">
        <Phone className="h-4 w-4" aria-hidden="true" />
        {`Gọi ${formatPhoneDisplay(hotline)}`}
      </a>
    </p>
  );
}
