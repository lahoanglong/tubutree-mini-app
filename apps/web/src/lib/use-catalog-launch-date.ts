'use client';

import { useContext } from 'react';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import type { PublicConfig } from '@tubutree/app-core/api/config';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { coreHttp } from './core-http';

const NO_PROVIDER_CLIENT = new QueryClient();

/**
 * Mốc ngày mở bán cho nhãn "Mới"; dùng chung khoá ['public-config'] và không tự tải lại khi đã có cache. Trả `undefined` khi config
 * chưa về lần đầu để thẻ chưa gắn nhãn (tránh nhãn hiện rồi tắt), `null` khi chưa đặt mốc, khi tải lỗi hoặc khi thẻ vẽ ngoài
 * QueryClientProvider (test, khung dựng sẵn): các trường hợp đó giữ luật 30 ngày.
 */
export function useCatalogLaunchDate(): string | null | undefined {
  const client = useContext(QueryClientContext);
  const q = useQuery(
    {
      ...publicConfigQuery(coreHttp),
      staleTime: Infinity,
      enabled: client !== undefined,
      select: (c: PublicConfig) => c.catalogLaunchDate ?? null,
    },
    client ?? NO_PROVIDER_CLIENT,
  );
  if (client === undefined) return null;
  // Tải lại lỗi vẫn giữ `data` cũ: không bỏ mốc đang có.
  if (q.data !== undefined) return q.data;
  if (q.isError) return null;
  return q.isPending ? undefined : null;
}
