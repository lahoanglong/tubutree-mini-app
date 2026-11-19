'use client';

import { useState, type ReactNode } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

export interface QuerySeedEntry {
  queryKey: QueryKey;
  data: unknown;
  /** Lúc máy chủ lấy dữ liệu (ms): trang ISR có thể cũ vài phút, nên query tự tải lại khi đã quá staleTime của nó. */
  fetchedAt: number;
}

/**
 * Nạp dữ liệu máy chủ đã lấy (trang ISR) vào bộ nhớ đệm React Query trước khi các khối con vẽ, để HTML máy chủ và lượt hydrate cùng thấy dữ liệu
 * (không vẽ khung chờ rồi đổi). Như HydrationBoundary của React Query nhưng không kéo thêm mã dehydrate. Nạp ngay trong lượt vẽ cả khi khoá đã
 * có mà chưa có dữ liệu: trang async nên đầu/chân trang (vd chân trang đọc cấu hình công khai) vẽ trước và đã tạo khoá rỗng; React Query báo
 * người theo dõi qua hàng đợi bất đồng bộ nên không cập nhật component khác giữa lúc vẽ. Khoá đã có dữ liệu (điều hướng trong app) thì giữ nguyên.
 */
export function QuerySeed({ entries, children }: { entries: readonly QuerySeedEntry[]; children: ReactNode }) {
  const qc = useQueryClient();
  useState(() => {
    for (const e of entries) {
      if (qc.getQueryData(e.queryKey) === undefined) qc.setQueryData(e.queryKey, e.data, { updatedAt: e.fetchedAt });
    }
    return null;
  });
  return children;
}
