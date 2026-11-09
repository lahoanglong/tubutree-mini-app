import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { quickReorderLines, type QuickReorderItem } from '@tubutree/app-core/commerce/quick-reorder';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useNotify } from '../../hooks/use-notify';
import { vi } from '../../i18n/vi';
import { getErrorMessage } from '../../services/api';
import { cartKey } from '../../services/cart-key';
import { addToCart } from '../../services/shop-api';
import { haptic } from '../../utils/haptic';
import { playCartFeedback } from '../../utils/cart-feedback';
import { useBundleAdd } from '../product/use-bundle-add';

const ADD_ALL_ID = 'quick-reorder';

/** Nút đã bấm làm nguồn của chấm bay tới giỏ; hỏi DOM thay vì giữ ref vì dải chỉ trao `item` cho `onAdd`. */
function addButtonOf(variationId: string): Element | null {
  const all = document.querySelectorAll('[data-testid="quick-reorder-add"]');
  return Array.from(all).find((el) => el.getAttribute('data-variation-id') === variationId) ?? null;
}

const ADD_ALL_BUTTON = '[data-testid="quick-reorder"] .tubu-quick-head button';

/**
 * Hành vi thêm của dải "Mua lại món quen": một chạm thêm đúng phân loại đã mua (số lượng 1, nguồn `repurchase`); "Thêm lại tất cả" là một lệnh lô
 * (máy chủ thêm hết hoặc không món nào). Mỗi lúc chỉ một lệnh bay: lệnh thứ hai bấm lúc lệnh đầu chưa xong bị bỏ.
 */
export function useQuickReorder() {
  const queryClient = useQueryClient();
  const { notify } = useNotify();
  const bundle = useBundleAdd();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const inflight = useRef(false);

  const addOne = async (item: QuickReorderItem) => {
    if (inflight.current || bundle.inFlight()) return;
    inflight.current = true;
    setBusyKey(item.variationId);
    try {
      const cart = await addToCart(item.variationId, 1, 'repurchase');
      queryClient.setQueryData(cartKey(), cart);
      haptic('medium');
      playCartFeedback(addButtonOf(item.variationId));
      notify({ text: vi.product.added, type: 'success', duration: 2000, position: 'top' });
    } catch (e) {
      notify({ text: getErrorMessage(e), type: 'error' });
    } finally {
      inflight.current = false;
      setBusyKey(null);
    }
  };

  const addAll = (items: readonly QuickReorderItem[]) => {
    if (inflight.current || busyKey !== null) return;
    bundle.add({
      id: ADD_ALL_ID,
      lines: quickReorderLines(items),
      errorKey: 'quickReorder.error',
      successText: fillCopy('quickReorder.addedAll', { n: items.length }),
      onDone: () => playCartFeedback(document.querySelector(ADD_ALL_BUTTON)),
    });
  };

  return { busyKey, busyAll: bundle.busyId === ADD_ALL_ID, addOne, addAll };
}
