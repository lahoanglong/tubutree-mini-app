'use client';

// Nguồn: apps/miniapp/src/components/product/use-bundle-add.ts
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useAuthPhase } from './auth-phase';
import { ApiError } from './client-api';
import { actionErrorText, isBusinessMessage } from './error-text';
import { loginHref } from './return-to';
import { addAllToCart } from './shop-combo';

export interface BundleAdd {
  /** Khoá riêng của lần thêm (id combo hay 'addons'): `busyId` và `result.id` trả lại để chỉ đúng nút/khối đó đổi. */
  id: string;
  lines: { variationId: string; quantity: number }[];
  /** Câu báo khi không có lời nghiệp vụ của máy chủ. */
  errorKey: string;
  successText: string;
  onDone?: () => void;
}

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
 * Web không có thông báo nổi nên kết quả là `result` để nơi gọi vẽ ở vùng `role="status"`. Khách chưa đăng nhập được chuyển sang
 * đăng nhập (kèm đường quay lại), chưa ghi gì vào giỏ.
 */
export function useBundleAdd() {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const phase = useAuthPhase();
  const inflight = useRef(false);
  const [result, setResult] = useState<BundleAddResult | null>(null);
  const mutation = useMutation({
    mutationFn: (v: BundleAdd) => addAllToCart(v.lines),
    onSuccess: (_data, v) => {
      void qc.invalidateQueries({ queryKey: ['cart'] });
      setResult({ id: v.id, ok: true, text: v.successText });
      v.onDone?.();
    },
    onError: (error, v) => setResult({ id: v.id, ok: false, text: errorText(error, fillCopy(v.errorKey)) }),
    onSettled: () => {
      inflight.current = false;
    },
  });
  return {
    add: (v: BundleAdd) => {
      if (inflight.current || v.lines.length === 0) return;
      if (phase === 'guest') {
        router.push(loginHref(pathname));
        return;
      }
      inflight.current = true;
      setResult(null);
      mutation.mutate(v);
    },
    busyId: mutation.isPending ? mutation.variables?.id : undefined,
    result,
  };
}
