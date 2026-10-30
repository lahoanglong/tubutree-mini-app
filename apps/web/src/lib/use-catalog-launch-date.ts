'use client';

import { useContext } from 'react';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import type { PublicConfig } from '@tubutree/app-core/api/config';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { coreHttp } from './core-http';

const NO_PROVIDER_CLIENT = new QueryClient();

/**
 * Mốc ngày mở bán cho nhãn "Mới"; dùng chung khoá ['public-config'] nên không thêm lời gọi API riêng. Thẻ sản phẩm có thể được vẽ
 * ngoài QueryClientProvider (test, khung dựng sẵn): khi đó trả null (luật 30 ngày như cũ) thay vì ném lỗi.
 */
export function useCatalogLaunchDate(): string | null {
  const client = useContext(QueryClientContext);
  const q = useQuery(
    { ...publicConfigQuery(coreHttp), staleTime: 5 * 60_000, enabled: client !== undefined, select: (c: PublicConfig) => c.catalogLaunchDate ?? null },
    client ?? NO_PROVIDER_CLIENT,
  );
  return q.data ?? null;
}
