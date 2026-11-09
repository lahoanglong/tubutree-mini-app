'use client';

import { useRef, useState } from 'react';
import { frequentlyBoughtLines, frequentlyBoughtSummary } from '@tubutree/app-core/commerce/frequently-bought';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { FrequentlyBoughtTogether } from '@/components/mini/frequently-bought-together';
import { playCartFeedback } from '@/lib/cart-feedback';
import { useBundleAdd } from '@/lib/use-bundle-add';
import { useFbt, type FbtHostArgs } from './use-fbt';

const FBT_ID = 'fbt';
/** Dòng của món đang xem bỏ tick bằng khoá riêng: đổi phân loại thì khoá dòng (`variationId`) đổi theo, nhưng khách đã bỏ tick món đang xem thì giữ bỏ tick. */
const CURRENT = 'current';

/**
 * Host web của `FrequentlyBoughtTogether` (cùng việc với `PdpFbt` ở Mini App): giữ phần khách bỏ tick (mặc định chọn hết, nên món mới vào bộ khi đổi phân loại tự được tick),
 * thêm các món đã chọn bằng một lệnh lô tất cả-hoặc-không (`useBundleAdd`; khách chưa đăng nhập được chuyển sang đăng nhập), mỗi món một đơn vị, ô Số lượng của trang không đổi theo bộ.
 * Ẩn hẳn khi không có bộ (món đang xem hết hàng hay chưa chọn được phân loại, gian hàng tạm nghỉ, không còn món bổ trợ). Web không có thông báo nổi nên kết quả đọc ở
 * vùng `role="status"` dưới khối (lời lỗi nghiệp vụ của máy chủ cũng ở đây).
 */
export function PdpFbt(props: FbtHostArgs) {
  const { bundle } = useFbt(props);
  const { add, busyId, result } = useBundleAdd();
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  const root = useRef<HTMLDivElement>(null);

  if (!bundle) return null;
  const { lines } = bundle;
  const offKey = (l: { isCurrent: boolean; key: string }) => (l.isCurrent ? CURRENT : l.key);
  const picked = new Set(lines.filter((l) => !off.has(offKey(l))).map((l) => l.key));
  const summary = frequentlyBoughtSummary(lines, picked);
  const toggle = (key: string) => {
    const line = lines.find((l) => l.key === key);
    if (!line) return;
    setOff((prev) => {
      const next = new Set(prev);
      if (!next.delete(offKey(line))) next.add(offKey(line));
      return next;
    });
  };
  const status = result?.id === FBT_ID ? result : null;
  return (
    <div ref={root} data-section="pdp-fbt">
      <FrequentlyBoughtTogether
        lines={lines}
        picked={picked}
        onToggle={toggle}
        onSelectAll={() => setOff(new Set())}
        summary={summary}
        busy={busyId === FBT_ID}
        onAdd={() =>
          add({
            id: FBT_ID,
            lines: frequentlyBoughtLines(lines, picked),
            errorKey: 'fbt.error',
            successText: fillCopy('fbt.added', { n: summary.count }),
            onDone: () => playCartFeedback(root.current?.querySelector('[data-testid="fbt-add"]') ?? null),
          })
        }
      />
      {/* Vùng báo luôn có mặt trong trang: vùng live vừa gắn cùng chữ thường không được đọc ra. */}
      <div role="status" data-testid="fbt-status" className={status ? 'tubu-fbt-status' : 'sr-only'}>
        {status && (
          <p role={status.ok ? undefined : 'alert'} className={status.ok ? 'text-success-fg' : 'text-danger-fg'}>
            {status.text}
          </p>
        )}
      </div>
    </div>
  );
}
