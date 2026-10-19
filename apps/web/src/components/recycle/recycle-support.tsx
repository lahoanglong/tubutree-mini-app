'use client';

import { useQuery } from '@tanstack/react-query';
import { supportContactQuery } from '@tubutree/app-core/queries/config';
import { coreHttp } from '@/lib/core-http';
import { skin } from '@/components/pro-shared/mini-skin';
import { formatPhoneDisplay } from '@/lib/phone-display';
import { platformBridge } from '@/lib/platform-bridge';

/** Khớp mặc định của API (DEFAULT_SUPPORT ở lib/api.ts): lỗi đọc cấu hình thì khách vẫn còn đường liên hệ. */
const DEFAULT_SUPPORT = { hotline: '0984 606 774', email: 'tubutree@gmail.com', zaloOaName: null };

/** Kênh liên hệ của trang theo dõi yêu cầu; kênh nào trống thì ẩn, không kênh nào thì ẩn cả khối. */
export function RecycleSupport() {
  const q = useQuery({ ...supportContactQuery(coreHttp), staleTime: 10 * 60_000 });
  const support = q.isError ? DEFAULT_SUPPORT : q.data;
  const hasOA = platformBridge.oa.available;
  const hotline = support?.hotline ?? null;
  const email = support?.email ?? null;
  if (!hasOA && !hotline && !email) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {hasOA && (
        <button type="button" className={skin.btnSecondary} onClick={() => void platformBridge.oa.openChat()}>
          Nhắn Zalo OA
        </button>
      )}
      {hotline && (
        <a href={`tel:${hotline.replace(/[^\d+]/g, '')}`} className={skin.btnSecondary}>
          {`Gọi hotline ${formatPhoneDisplay(hotline)}`}
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`} className={`${skin.btnSecondary} break-all`}>
          {email}
        </a>
      )}
    </div>
  );
}
