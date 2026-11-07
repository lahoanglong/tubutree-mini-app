import { useRef, useState } from 'react';
import { frequentlyBoughtLines, frequentlyBoughtSummary, type FbtBundle } from '@tubutree/app-core/commerce/frequently-bought';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { playCartFeedback } from '../../utils/cart-feedback';
import { FrequentlyBoughtTogether } from '../ui/frequently-bought-together';
import { useBundleAdd } from './use-bundle-add';

const FBT_ID = 'fbt';
const ADD_BUTTON = '[data-testid="fbt-add"]';

/**
 * Sản phẩm đã có trong giỏ lúc giỏ tải xong lần đầu của trang này, đóng băng cho tới khi đổi sản phẩm. Thêm cả bộ xong, giỏ tải lại có chính các món vừa thêm:
 * nếu loại chúng khỏi gợi ý thì khối biến mất giữa trang và dải "Khách thường mua cùng" bên dưới nhảy món. `settled` false (đang chờ giỏ) thì trả null để
 * trang chưa chọn món nào, tránh chọn rồi đổi khi giỏ về.
 */
export function useFbtCartProductIds(
  slug: string | undefined,
  items: readonly { productId?: string }[] | undefined,
  settled: boolean,
): ReadonlySet<string> | null {
  const frozen = useRef<{ slug: string | undefined; ids: ReadonlySet<string> } | null>(null);
  if (frozen.current && frozen.current.slug !== slug) frozen.current = null;
  if (!frozen.current && settled) {
    frozen.current = { slug, ids: new Set((items ?? []).flatMap((l) => (l.productId ? [l.productId] : []))) };
  }
  return frozen.current?.ids ?? null;
}

/** Dòng của món đang xem bỏ tick bằng khoá riêng: đổi phân loại thì khoá dòng (`variationId`) đổi theo, nhưng khách đã bỏ tick món đang xem thì giữ bỏ tick (cùng web). */
const CURRENT = 'current';
const offKey = (l: { isCurrent: boolean; key: string }) => (l.isCurrent ? CURRENT : l.key);

/**
 * Host Mini App của `FrequentlyBoughtTogether`: giữ phần khách bỏ tick (mặc định chọn hết, nên món mới vào bộ khi đổi phân loại tự được tick), và thêm
 * các món đã chọn bằng một lệnh lô tất cả-hoặc-không (`useBundleAdd`). Bộ (món, giá) do trang dựng bằng `buildFrequentlyBoughtBundle`.
 */
export function PdpFbt({ bundle }: { bundle: FbtBundle }) {
  const { add, busyId } = useBundleAdd();
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  const picked = new Set(bundle.lines.filter((l) => !off.has(offKey(l))).map((l) => l.key));
  const summary = frequentlyBoughtSummary(bundle.lines, picked);

  const toggle = (key: string) => {
    const line = bundle.lines.find((l) => l.key === key);
    if (!line) return;
    setOff((prev) => {
      const next = new Set(prev);
      if (!next.delete(offKey(line))) next.add(offKey(line));
      return next;
    });
  };

  return (
    <FrequentlyBoughtTogether
      lines={bundle.lines}
      picked={picked}
      onToggle={toggle}
      summary={summary}
      busy={busyId === FBT_ID}
      onAdd={() =>
        add({
          id: FBT_ID,
          lines: frequentlyBoughtLines(bundle.lines, picked),
          errorKey: 'fbt.error',
          successText: fillCopy('fbt.added', { n: summary.count }),
          onDone: () => playCartFeedback(document.querySelector(ADD_BUTTON)),
        })
      }
    />
  );
}
