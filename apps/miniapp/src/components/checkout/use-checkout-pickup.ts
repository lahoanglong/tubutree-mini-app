import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { QuotePendingGiftDTO } from '@tubutree/shared-types';
import {
  pickupFieldsOf,
  pruneExcludedGifts,
  reconcileDraft,
  selectGiftForOrder,
  type PickupDraft,
} from '@tubutree/app-core/checkout-pickup-state';
import { returnNudge } from '@tubutree/app-core/return-packaging';
import { getCheckoutPickupOptions } from '../../services/shop-api';

export const PICKUP_OPTIONS_KEY = 'checkout-pickup-options';

/**
 * Trạng thái "Đổi rác kèm đơn" và quà 0đ của màn Thanh toán. Lựa chọn đã áp (`applied`) và quà để đơn sau (`excluded`) tạo ra
 * `fields` đưa vào báo giá và đặt đơn; luật đối chiếu và dựng thân nằm ở app-core (cùng bản với web).
 * Danh sách món chỉ tải khi mở tấm hoặc đã có lựa chọn cần đối chiếu (đổi địa chỉ có thể làm món Pin cũ bị chặn).
 */
export function useCheckoutPickup(args: {
  enabled: boolean;
  addressId: string | null;
  itemIds: string[] | undefined;
  onReconciled?: () => void;
  /** Cờ `checkout.return_packaging_nudge_enabled`: tải danh sách món ngay để thẻ điền sẵn bao bì của đơn đã giao. */
  nudgeEnabled?: boolean;
}) {
  const { enabled, addressId, itemIds, onReconciled, nudgeEnabled = false } = args;
  const [applied, setApplied] = useState<PickupDraft | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [maxOpenError, setMaxOpenError] = useState<string | null>(null);
  const itemIdsKey = itemIds ? itemIds.join(',') : '';

  const optionsQ = useQuery({
    queryKey: [PICKUP_OPTIONS_KEY, addressId, itemIdsKey],
    queryFn: () => getCheckoutPickupOptions({ addressId: addressId!, itemIds }),
    enabled: enabled && !!addressId && (sheetOpen || applied !== null || nudgeEnabled),
  });
  const options = optionsQ.data;

  // Tính ngay lúc vẽ (không chờ effect) để báo giá không bao giờ đi với món đã bị chặn của địa chỉ mới.
  const reconciled = useMemo(() => (applied && options ? reconcileDraft(applied, options) : null), [applied, options]);
  const effective = reconciled ? reconciled.draft : applied;
  useEffect(() => {
    if (!reconciled?.changed) return;
    setApplied(reconciled.draft);
    onReconciled?.();
  }, [reconciled]);

  // Gợi ý gửi lại bao bì chỉ hiện khi chưa chọn gì; đã chọn thì thẻ tóm tắt lựa chọn như cũ.
  const nudge = useMemo(() => (nudgeEnabled && effective === null ? returnNudge(options) : null), [nudgeEnabled, effective, options]);
  const fields = useMemo(() => pickupFieldsOf(effective, excluded), [effective, excluded]);
  const fieldsKey = JSON.stringify(fields);
  // Có lựa chọn cần đối chiếu mà danh sách chưa về: chưa báo giá, kẻo báo giá với món có thể bị máy chủ từ chối (400).
  const ready = applied === null || optionsQ.isSuccess || optionsQ.isError;

  const toggleGift = useCallback(
    (id: string, receive: boolean, pending?: readonly QuotePendingGiftDTO[]) =>
      setExcluded((prev) => selectGiftForOrder(pending, prev, id, receive)),
    [],
  );
  const pruneGifts = useCallback((pending: readonly QuotePendingGiftDTO[] | undefined) => {
    setExcluded((prev) => {
      const next = pruneExcludedGifts(prev, pending);
      return next.length === prev.length ? prev : next;
    });
  }, []);

  const apply = useCallback((draft: PickupDraft | null) => {
    setMaxOpenError(null);
    setApplied(draft);
  }, []);
  const clear = useCallback(() => {
    setMaxOpenError(null);
    setApplied(null);
  }, []);

  return {
    applied: effective,
    apply,
    clear,
    maxOpenError,
    setMaxOpenError,
    excluded,
    toggleGift,
    pruneGifts,
    sheetOpen,
    setSheetOpen,
    options,
    optionsLoading: optionsQ.isLoading,
    optionsError: optionsQ.isError && !options,
    refetchOptions: optionsQ.refetch,
    fields,
    fieldsKey,
    ready,
    nudge,
  };
}
