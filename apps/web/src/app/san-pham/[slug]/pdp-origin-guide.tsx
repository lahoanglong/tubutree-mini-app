import Link from 'next/link';
import { MapPin } from 'lucide-react';
import { pdpOriginCopy, type PdpOriginView } from '@tubutree/app-core/commerce/pdp-origin';
import { PdpDetailRow } from '@/components/mini/pdp-detail-row';

const CAPTION = 'text-[length:var(--type-caption-size)] leading-[var(--type-caption-lh)]';
const BODY_SM = 'text-[length:var(--type-body-sm-size)] leading-[var(--type-body-sm-lh)]';

/**
 * Dòng "Nguồn gốc & cách dùng" của dải Chi tiết sản phẩm (`pdpOriginView` của app-core), cùng số đo với `PdpOriginGuide` của Mini App: gập sẵn kèm tỉnh
 * của nhãn để đọc lướt, mở ra là các dòng Đến từ, Cách dùng, Bảo quản, Hạn dùng/số lô. Thành phần máy chủ; phần gập/mở là `PdpDetailRow` (chữ đang gập
 * vẫn nằm trong HTML cho công cụ tìm kiếm). Lối bản đồ chỉ có khi đầu trang chưa có chip xuất xứ.
 */
export function PdpOriginGuide({ view }: { view: PdpOriginView | null }) {
  if (!view) return null;
  return (
    <PdpDetailRow block="origin" title={view.title} hint={view.hint}>
      <dl className="flex flex-col gap-2">
        {view.rows.map((row) => (
          <div key={row.key} data-testid={`pdp-origin-${row.key}`}>
            <dt className={`${CAPTION} text-[var(--color-text-secondary)]`}>{row.label}</dt>
            <dd className={`${BODY_SM} m-0 text-[var(--color-text-primary)]`}>
              {row.lines.length > 1 ? (
                <ul className="m-0 list-disc pl-4">
                  {row.lines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              ) : (
                row.lines[0]
              )}
              {row.key === 'origin' && view.map && (
                <Link
                  href={`/cau-chuyen?brand=${encodeURIComponent(view.map.id)}`}
                  data-testid="pdp-origin-map"
                  aria-label={view.map.spoken}
                  className={`${CAPTION} tubu-hit-44 flex w-fit items-center gap-0.5 font-semibold text-[var(--color-text-brand)]`}
                >
                  <MapPin aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 flex-none" />
                  {pdpOriginCopy('map')}
                </Link>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </PdpDetailRow>
  );
}
