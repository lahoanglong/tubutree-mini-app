import Link from 'next/link';
import { ChevronDown, MapPin } from 'lucide-react';
import { pdpOriginCopy, type PdpOriginView } from '@tubutree/app-core/commerce/pdp-origin';
import { pdpSectionTitle } from './pdp-ui';

const CAPTION = 'text-[length:var(--type-caption-size)] leading-[var(--type-caption-lh)]';
const BODY_SM = 'text-[length:var(--type-body-sm-size)] leading-[var(--type-body-sm-lh)]';

/**
 * Khối "Nguồn gốc & cách dùng" (`pdpOriginView` của app-core), cùng số đo với `PdpOriginGuide` của Mini App: gập sẵn thành một dòng tiêu đề kèm
 * tỉnh của nhãn để đọc lướt, mở ra là các dòng Đến từ, Cách dùng, Bảo quản, Hạn dùng/số lô.
 * Thành phần máy chủ dùng thẻ `<details>`: trình duyệt tự gập/mở nên trang không thêm byte JS nào, và chữ đang gập vẫn nằm trong HTML cho công cụ
 * tìm kiếm. Điện thoại là dải trắng riêng như Mini App; từ md là khối thường như Thành phần. Lối bản đồ chỉ có khi đầu trang chưa có chip xuất xứ.
 */
export function PdpOriginGuide({ view }: { view: PdpOriginView | null }) {
  if (!view) return null;
  return (
    <details
      data-pdp-block="origin"
      data-section="pdp-origin"
      data-testid="pdp-origin"
      className="group mt-2 bg-[var(--color-bg-surface)] px-4 py-1 md:mt-8 md:bg-transparent md:px-0 md:py-0"
    >
      <summary
        data-testid="pdp-origin-toggle"
        className="flex min-h-[var(--section-header-h)] cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden"
      >
        <span className={`${pdpSectionTitle} min-w-0 flex-1`}>{view.title}</span>
        {view.hint && <span className={`${CAPTION} min-w-0 truncate text-[var(--color-text-secondary)] group-open:hidden`}>{view.hint}</span>}
        <ChevronDown aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 flex-none text-[var(--color-text-tertiary)] group-open:rotate-180" />
      </summary>
      <dl className="flex flex-col gap-2 pb-2">
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
    </details>
  );
}
