'use client';

// Nguồn: apps/miniapp/src/components/product/use-bundle-add.ts
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import type { ComboView } from '@tubutree/app-core/commerce/bundle-view';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useAuthPhase } from './auth-phase';
import { ApiError } from './client-api';
import { actionErrorText, isBusinessMessage } from './error-text';
import { guestCartFlagNow } from './guest-cart/flag';
import { addGuestLines, GUEST_CART_MAX_LINES } from './guest-cart/store';
import { loginHref } from './return-to';
import { serverRejectedState } from './server-rejected-state';
import { settleWithin } from './settle-within';
import { addAllToCart } from './shop-combo';

export interface BundleAdd {
  /** Khoá riêng của lần thêm (id combo hay 'addons'): `busyId` và `result.id` trả lại để chỉ đúng nút/khối đó đổi. */
  id: string;
  /**
   * `slug` là của giỏ khách (giỏ trong trình duyệt tra lại món theo slug); nơi gọi không có slug cho đủ mọi dòng thì khách vẫn được đưa sang đăng nhập như trước.
   * Máy chủ không nhận trường này: lệnh lô chỉ gửi `variationId` và `quantity`.
   */
  lines: { variationId: string; quantity: number; slug?: string }[];
  /** Câu báo khi không có lời nghiệp vụ của máy chủ. */
  errorKey: string;
  successText: string;
  /** Nhận giỏ máy chủ trả sau lệnh thêm (vd trang Bộ quà tặng nói còn thiếu bao nhiêu tới Miễn phí giao hàng). `null` khi khách chưa đăng nhập thêm vào giỏ trình duyệt: chưa có giỏ máy chủ để đọc. */
  onDone?: (cart: Awaited<ReturnType<typeof addAllToCart>> | null) => void;
}

/** Gắn slug vào dòng giỏ theo phân loại. Nguồn là các dòng hiển thị (combo, mua kèm, gợi ý mua kèm) vốn đã có slug từng món; phân loại không có trong nguồn thì dòng đó không có slug. */
export function withSlugs(
  lines: readonly { variationId: string; quantity: number }[],
  sources: readonly { variationId: string; slug: string }[],
): BundleAdd['lines'] {
  const slugOf = new Map(sources.map((s) => [s.variationId, s.slug]));
  return lines.map((l) => {
    const slug = slugOf.get(l.variationId);
    return slug ? { ...l, slug } : { ...l };
  });
}

/** Dòng của một combo kèm slug: món `i` của `items` ứng với dòng `i` của `lines` (`comboView` dựng cả hai từ cùng một danh sách món). */
export function comboBundleLines(v: Pick<ComboView, 'items' | 'lines'>): BundleAdd['lines'] {
  return withSlugs(v.lines, v.lines.map((l, i) => ({ variationId: l.variationId, slug: v.items[i]?.slug ?? '' })));
}

/** Giữ khoá chừng này sau khi thêm vào giỏ khách (cùng mức với nút Thêm vào giỏ của trang sản phẩm). */
const GUEST_ADD_LOCK_MS = 400;

export interface BundleAddResult {
  id: string;
  ok: boolean;
  text: string;
}

/** Lỗi 4xx có lời nghiệp vụ ("Sản phẩm X đã hết hàng") thì đọc thẳng; còn lại câu cố định, vì lời "mạng chậm, chưa rõ đã xong chưa" sai nghĩa với lệnh tất cả-hoặc-không. */
function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status < 500 && isBusinessMessage(error.message)) return actionErrorText(error);
  return fallback;
}

/**
 * "Thêm cả combo" và "Thêm n món vào giỏ" của web: một lệnh `addAllToCart` (máy chủ thêm hết hoặc không món nào), mỗi lúc chỉ một lệnh bay.
 * Web không có thông báo nổi nên kết quả là `result` để nơi gọi vẽ ở vùng `role="status"`. Khách chưa đăng nhập: cờ `web.guest_cart_enabled` bật và mọi dòng có `slug`
 * thì cả bộ vào giỏ trong trình duyệt bằng một lần ghi (hết hoặc không món nào), không rời trang; còn lại được chuyển sang đăng nhập (kèm đường quay lại), chưa ghi gì vào giỏ.
 * `staleKeys` là các khoá truy vấn mà màn đang vẽ từ đó: danh sách bộ để thêm, và dữ liệu khác của màn mà bộ phụ thuộc (tồn kho của món đang xem). Máy chủ từ chối vì trạng thái
 * đã đổi (400/404/409/422: món hết hàng, ngừng bán, bộ hết hạn) thì chúng đã cũ nên tải lại đúng các khoá này rồi mới nhả khoá (tối đa 4 giây), kẻo chạm lại nhận đúng lời từ chối đó.
 */
export function useBundleAdd(staleKeys: readonly (readonly unknown[])[]) {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const phase = useAuthPhase();
  const inflight = useRef(false);
  const [result, setResult] = useState<BundleAddResult | null>(null);
  const mutation = useMutation({
    mutationFn: (v: BundleAdd) => addAllToCart(v.lines.map(({ variationId, quantity }) => ({ variationId, quantity }))),
    onSuccess: (cart, v) => {
      void qc.invalidateQueries({ queryKey: ['cart'] });
      setResult({ id: v.id, ok: true, text: v.successText });
      v.onDone?.(cart);
    },
    onError: (error, v) => {
      setResult({ id: v.id, ok: false, text: errorText(error, fillCopy(v.errorKey)) });
      return serverRejectedState(error) ? settleWithin(Promise.all(staleKeys.map((queryKey) => qc.invalidateQueries({ queryKey })))) : undefined;
    },
    onSettled: () => {
      inflight.current = false;
    },
  });
  // Khách chưa đăng nhập: cờ giỏ khách bật và mọi dòng có `slug` thì cả bộ vào giỏ trình duyệt; còn lại đi lối cũ (sang đăng nhập). Cờ đọc lúc bấm
  // (bản đã có sẵn, chưa có thì chờ ngắn) để khối không gọi cấu hình ngay khi vẽ.
  const addAsGuest = async (v: BundleAdd) => {
    let keepLock = false;
    setResult(null);
    try {
      const guestLines = v.lines.flatMap((l) => (l.slug ? [{ variationId: l.variationId, slug: l.slug, quantity: l.quantity }] : []));
      if (guestLines.length === v.lines.length && (await guestCartFlagNow(qc))) {
        const res = addGuestLines(guestLines);
        if (res.ok) {
          // Thêm vào giỏ trình duyệt là việc đồng bộ: giữ khoá ngắn để chạm đúp không cộng hai lần.
          keepLock = true;
          window.setTimeout(() => {
            inflight.current = false;
          }, GUEST_ADD_LOCK_MS);
          setResult({ id: v.id, ok: true, text: v.successText });
          v.onDone?.(null);
          return;
        }
        if (res.reason !== 'storage') {
          setResult({ id: v.id, ok: false, text: res.reason === 'full' ? fillCopy('guestCart.full', { n: GUEST_CART_MAX_LINES }) : fillCopy('guestCart.atMax') });
          return;
        }
      }
      router.push(loginHref(pathname));
    } finally {
      if (!keepLock) inflight.current = false;
    }
  };
  return {
    add: (v: BundleAdd) => {
      if (inflight.current || v.lines.length === 0) return;
      if (phase === 'guest') {
        inflight.current = true;
        void addAsGuest(v);
        return;
      }
      inflight.current = true;
      setResult(null);
      mutation.mutate(v);
    },
    busyId: mutation.isPending ? mutation.variables?.id : undefined,
    /** Đọc khoá đồng bộ: đúng ngay trong cú bấm, khác `busyId` chỉ đúng sau lần vẽ kế. Để nơi có thêm đường thêm giỏ khác (dải Mua lại món quen) khoá chéo. */
    isBusy: () => inflight.current,
    result,
  };
}
