'use client';

import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { myRefillPairsQuery, refillFirstOn, refillQueryIds } from '@tubutree/app-core/refill/refill-api';
import {
  REFILL_UNDO_MS,
  applyRefillSwap,
  undoRefillSwap,
  type RefillCartOps,
  type RefillSwapReceipt,
  type RefillSwapView,
} from '@tubutree/app-core/refill/refill-swap';
import { trackWebEvent } from '@/lib/analytics';
import { coreHttp } from '@/lib/core-http';
import { addToCart, removeCartItem, type CartLine, type CartSummary } from '@/lib/shop-client';
import { useAutoDismiss } from '@/lib/use-auto-dismiss';
import { useCartWrite } from '@/lib/use-cart-write';
import { usePublicConfig } from '@/lib/use-public-config';

const ops: RefillCartOps<CartSummary> = { add: (v, q) => addToCart(v, q), remove: removeCartItem };
const CART = { surface: 'cart' };

/**
 * Đổi dòng chai sang gói Refill ở giỏ (cờ `catalog.refill_first_enabled`), cùng luật với `useCartRefill` của Mini App. Cờ tắt thì không gọi máy chủ và
 * `pairs` rỗng. Đổi và Hoàn tác dùng chung một khoá; phản hồi giỏ ghi qua `useCartWrite` như mọi lệnh giỏ khác của màn (lệnh chồng thì tải lại giỏ).
 */
export function useCartRefill(lines: readonly CartLine[] | undefined, onError: (e: unknown) => void, onApplied?: () => void) {
  const on = refillFirstOn(usePublicConfig());
  const ids = refillQueryIds((lines ?? []).map((l) => l.productId));
  const pairs = useQuery({ ...myRefillPairsQuery(coreHttp, ids), enabled: on && ids.length > 0 }).data;
  const cartWrite = useCartWrite();
  const [confirm, setConfirm] = useState<RefillSwapView | null>(null);
  const [receipt, setReceipt] = useState<RefillSwapReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const hold = useAutoDismiss(!!receipt, REFILL_UNDO_MS, () => setReceipt(null), receipt);
  const run = <T>(task: () => Promise<T>, cart: (r: T) => CartSummary, done: (r: T) => void) => {
    lock.current = true;
    setBusy(true);
    const cmd = cartWrite.begin();
    task()
      .then(
        (r) => {
          void cartWrite.write(cmd, cart(r));
          done(r);
        },
        (e: unknown) => {
          void cartWrite.fail(cmd, true);
          onError(e);
        },
      )
      .finally(() => {
        lock.current = false;
        setBusy(false);
      });
  };
  const apply = (view: RefillSwapView) => {
    setConfirm(null);
    if (lock.current) return;
    run(
      () => applyRefillSwap(ops, view),
      (r) => r.cart,
      (r) => {
        setReceipt(r.receipt);
        onApplied?.();
        trackWebEvent('refill_swap_applied', CART);
      },
    );
  };
  const undo = () => {
    if (!receipt || lock.current) return;
    setReceipt(null);
    run(
      () => undoRefillSwap(ops, receipt),
      (c) => c,
      () => trackWebEvent('refill_swap_undone', CART),
    );
  };
  return {
    pairs: on ? pairs : undefined,
    confirm,
    cancel: () => setConfirm(null),
    receipt,
    hold,
    dismiss: () => setReceipt(null),
    busy,
    apply,
    undo,
    press: (v: RefillSwapView) => (v.needsConfirm ? setConfirm(v) : apply(v)),
  };
}
