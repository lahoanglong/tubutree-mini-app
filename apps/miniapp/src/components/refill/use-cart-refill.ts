import { useEffect, useRef, useState } from 'react';
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
import { usePublicConfig } from '../../hooks/use-public-config';
import { trackEvent } from '../../services/analytics';
import { coreHttp } from '../../services/core-http';
import { addToCart, removeCartItem, type CartLine, type CartSummary } from '../../services/shop-api';

const ops: RefillCartOps<CartSummary> = { add: (v, q) => addToCart(v, q), remove: removeCartItem };
const CART = { surface: 'cart' };

/** Nhịp sửa giỏ của màn giỏ: `begin` chặn lần đọc giỏ đang bay (bản đọc cũ về sau ghi đè kết quả đổi), `end` đọc lại khi không còn lệnh nào. */
export interface CartEditHooks {
  begin: () => Promise<unknown>;
  end: () => void;
}

/**
 * Đổi dòng chai sang gói Refill ở giỏ (cờ `catalog.refill_first_enabled`): cặp chỉ có cho chai khách đã nhận trong đơn đã giao. Cờ tắt
 * thì không gọi máy chủ và `pairs` rỗng. Đổi và Hoàn tác dùng chung một khoá: lệnh sau không chen vào giữa hai bước của lệnh trước.
 */
export function useCartRefill(lines: readonly CartLine[] | undefined, onCart: (c: CartSummary) => void, onError: (e: unknown) => void, edit: CartEditHooks) {
  const on = refillFirstOn(usePublicConfig());
  const ids = refillQueryIds((lines ?? []).map((l) => l.productId));
  const pairs = useQuery({ ...myRefillPairsQuery(coreHttp, ids), enabled: on && ids.length > 0 }).data;
  const [confirm, setConfirm] = useState<RefillSwapView | null>(null);
  const [receipt, setReceipt] = useState<RefillSwapReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const run = <T>(task: () => Promise<T>, done: (r: T) => void) => {
    lock.current = true;
    setBusy(true);
    edit
      .begin()
      .then(task)
      .then(done, onError)
      .finally(() => {
        lock.current = false;
        setBusy(false);
        edit.end();
      });
  };
  const apply = (view: RefillSwapView) => {
    setConfirm(null);
    if (lock.current) return;
    run(
      () => applyRefillSwap(ops, view),
      (r) => {
        onCart(r.cart);
        setReceipt(r.receipt);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setReceipt(null), REFILL_UNDO_MS);
        trackEvent('refill_swap_applied', 'miniapp', CART);
      },
    );
  };
  const undo = () => {
    if (!receipt || lock.current) return;
    setReceipt(null);
    run(
      () => undoRefillSwap(ops, receipt),
      (c) => {
        onCart(c);
        trackEvent('refill_swap_undone', 'miniapp', CART);
      },
    );
  };
  return {
    pairs: on ? pairs : undefined,
    confirm,
    cancel: () => setConfirm(null),
    receipt,
    dismiss: () => setReceipt(null),
    busy,
    apply,
    undo,
    press: (v: RefillSwapView) => (v.needsConfirm ? setConfirm(v) : apply(v)),
  };
}
