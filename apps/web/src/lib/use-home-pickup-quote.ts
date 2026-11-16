'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { WasteLineInput, WasteMeItemDTO, WastePickupQuoteRequest, WastePickupQuoteResponse } from '@tubutree/shared-types';
import { WASTE_QUERY_KEYS, getWastePickupQuote } from '@tubutree/app-core/api/waste';
import {
  HOME_PICKUP_QUOTE_DEBOUNCE_MS,
  defaultHomePickupWeight,
  estimateLinesGrams,
  homePickupQuoteRequest,
  pickHomePickupAddress,
  type HomePickupForm,
} from '@tubutree/app-core/recycle-home-pickup-state';
import { homePickupUnavailableText, type HomePickupQuoteState } from '@tubutree/app-core/recycle-home-pickup-view';
import { coreHttp } from '@/lib/core-http';
import { getAddresses, type AddressDTO } from '@/lib/shop-client';
import { useDebounced } from '@/lib/use-debounced';

export interface HomePickupQuote {
  addresses: readonly AddressDTO[];
  addressesStatus: 'loading' | 'error' | 'ready';
  refetchAddresses: () => void;
  /** Địa chỉ đang dùng: cái khách chọn, không thì mặc định (đã áp vào thân báo phí và thân tạo đơn). */
  address: AddressDTO | null;
  weightGrams: number;
  /** Lựa chọn đã chốt (địa chỉ và số kg thật sự được gửi đi), dùng cho khoá chống gửi trùng và thân tạo đơn. */
  effective: HomePickupForm;
  quote: WastePickupQuoteResponse | undefined;
  quoteState: HomePickupQuoteState;
  /** Câu của máy chủ khi báo phí lỗi 503 (chưa báo được phí); null thì màn dùng câu chung. */
  quoteErrorText: string | null;
  refetchQuote: () => void;
}

/**
 * Sổ địa chỉ và báo phí của cách "Shipper lấy tận nhà", cùng logic với Mini App (hooks/use-home-pickup-quote.ts).
 * Báo phí chờ khách ngừng đổi địa chỉ/món/số kg rồi mới hỏi; trong lúc chờ hoặc đang hỏi, `quoteState` là 'loading' để nút tạo đơn không bấm được trên phí cũ.
 */
export function useHomePickupQuote(args: {
  enabled: boolean;
  form: HomePickupForm;
  lines: readonly WasteLineInput[];
  items: readonly WasteMeItemDTO[];
}): HomePickupQuote {
  const { enabled, form, lines, items } = args;
  const addressesQ = useQuery({ queryKey: ['addresses'], queryFn: getAddresses, enabled });
  const addresses = addressesQ.data ?? [];
  const address = pickHomePickupAddress(addresses, form.addressId);
  const weightGrams = form.weightGrams ?? defaultHomePickupWeight(estimateLinesGrams(lines, items));
  const effective: HomePickupForm = { addressId: address?.id ?? null, weightGrams, payment: form.payment ?? null };

  const requestKey = JSON.stringify(homePickupQuoteRequest(effective, lines));
  const debouncedKey = useDebounced(requestKey, HOME_PICKUP_QUOTE_DEBOUNCE_MS);
  const debounced = useMemo(() => JSON.parse(debouncedKey) as WastePickupQuoteRequest | null, [debouncedKey]);
  const settled = debouncedKey === requestKey;
  const quoteQ = useQuery({
    queryKey: [...WASTE_QUERY_KEYS.all, 'pickup-quote', debounced],
    queryFn: () => getWastePickupQuote(coreHttp, debounced as WastePickupQuoteRequest),
    enabled: enabled && debounced !== null,
    staleTime: 0,
  });

  let quoteState: HomePickupQuoteState;
  if (requestKey === 'null') quoteState = 'idle';
  else if (!settled || quoteQ.isPending) quoteState = 'loading';
  else quoteState = quoteQ.data === undefined ? 'error' : 'ready';

  return {
    addresses,
    addressesStatus: addressesQ.isError ? 'error' : addressesQ.isPending ? 'loading' : 'ready',
    refetchAddresses: () => void addressesQ.refetch(),
    address,
    weightGrams,
    effective,
    quote: quoteState === 'ready' ? quoteQ.data : undefined,
    quoteState,
    quoteErrorText: quoteState === 'error' ? homePickupUnavailableText(quoteQ.error) : null,
    refetchQuote: () => void quoteQ.refetch(),
  };
}
