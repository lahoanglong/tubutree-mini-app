'use client';

import { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CartSummary } from '@/lib/shop-client';
import { cartKey } from '@/lib/cart-key';

/**
 * Cách ghi phản hồi giỏ của các lệnh giỏ chạy song song theo từng đích (từng dòng, từng món). Mỗi phản hồi là NGUYÊN giỏ, nên hai lệnh khác đích
 * bay chồng nhau mà phản hồi về lệch thứ tự thì phản hồi cũ ghi đè phần của lệnh mới (dòng vừa đổi số lượng quay về số cũ). Một lệnh đi một mình thì
 * ghi thẳng phản hồi cho nhanh; đã có lệnh khác cùng khoá bay chồng thì bỏ phản hồi và tải lại giỏ từ máy chủ, như Mini App (không bao giờ ghi phản hồi).
 * Gắn `began` vào `onMutate`, `write` vào `onSuccess`, `settled` vào `onSettled` của mutation có `mutationKey`.
 * Khi phải tải lại, `write` TRẢ lời hứa tải lại và `onSuccess` trả nó ra: TanStack Query đợi nó trước `onSettled`, nên lệnh còn tính là đang bay (khoá của dòng/món còn giữ)
 * cho tới khi giỏ mới về. Nhả khoá sớm hơn thì nút bấm được trong lúc giỏ hiện còn cũ: số lượng tính từ số cũ, hoặc thêm lần hai một món đã vào giỏ.
 * Lệnh chồng đến sau huỷ lần tải của lệnh trước nhưng lời hứa của lệnh trước vẫn đợi lần tải mới (TanStack Query v5); hai spec "hoàn tất TRƯỚC" canh điều này khi nâng bản.
 */
export function useCartWrite(mutationKey: readonly unknown[]) {
  const qc = useQueryClient();
  const overlapped = useRef(false);
  return {
    began: () => {
      if (qc.isMutating({ mutationKey }) > 1) overlapped.current = true;
    },
    write: (cart: CartSummary): Promise<void> | undefined => {
      if (overlapped.current) return qc.invalidateQueries({ queryKey: ['cart'] });
      qc.setQueryData(cartKey(), cart);
      return undefined;
    },
    // `onSettled` chạy khi lệnh này còn tính là đang bay: về một mình thì hết chồng.
    settled: () => {
      if (qc.isMutating({ mutationKey }) <= 1) overlapped.current = false;
    },
  };
}
