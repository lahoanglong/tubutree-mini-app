'use client';

import { useContext } from 'react';
import { QueryClientContext, useQuery } from '@tanstack/react-query';
import { Phone } from 'lucide-react';
import { supportContactQuery } from '@tubutree/app-core/queries/config';
import { coreHttp } from '@/lib/core-http';
import { formatPhoneDisplay } from '@/lib/phone-display';

/** Khớp mặc định của API: lỗi đọc cấu hình thì màn lỗi vẫn còn đường liên hệ. */
const DEFAULT_HOTLINE = '0984 606 774';

/**
 * "Cần hỗ trợ? Gọi <hotline>" cho màn lỗi, như SupportHotline của Mini App; hotline đọc từ cấu hình công khai.
 * Màn lỗi nằm ở khắp nơi, kể cả chỗ dựng không có QueryClientProvider: khi đó chỉ ẩn dòng này, không làm vỡ cả màn lỗi.
 */
export function SupportHotline() {
  return useContext(QueryClientContext) ? <HotlineLine /> : null;
}

function HotlineLine() {
  const q = useQuery({ ...supportContactQuery(coreHttp), staleTime: 10 * 60_000 });
  const hotline = q.isError ? DEFAULT_HOTLINE : q.data?.hotline;
  if (!hotline) return null;
  return (
    <p className="flex flex-wrap items-center justify-center gap-1 text-sm text-stone-600">
      <span>Cần hỗ trợ?</span>
      <a href={`tel:${hotline.replace(/[^\d+]/g, '')}`} className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap px-2 font-semibold tabular-nums text-forest-700 underline">
        <Phone className="h-4 w-4" aria-hidden="true" />
        {`Gọi ${formatPhoneDisplay(hotline)}`}
      </a>
    </p>
  );
}
