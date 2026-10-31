'use client';

import { useContext } from 'react';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { coreHttp } from './core-http';

const NO_PROVIDER_CLIENT = new QueryClient();

/**
 * Ngưỡng miễn phí giao hàng cho nhãn trên thẻ. Chỉ khi cấu hình đã về từ máy chủ: giá trị mặc định của `usePublicConfig` chỉ để giữ chỗ
 * UI, hứa con số đó lên thẻ rồi đổi ý thì nhãn "Miễn phí giao hàng" chớp rồi tắt. Thẻ vẽ ngoài QueryClientProvider (test, khung dựng
 * sẵn) thì không có nhãn. Dùng chung khoá ['public-config'] nên không phát sinh request mới.
 */
export function useFreeShipThreshold(): number | null {
  const client = useContext(QueryClientContext);
  const q = useQuery(
    { ...publicConfigQuery(coreHttp), staleTime: 5 * 60_000, enabled: client !== undefined, select: (c) => c.freeshipThreshold },
    client ?? NO_PROVIDER_CLIENT,
  );
  return client === undefined ? null : (q.data ?? null);
}
