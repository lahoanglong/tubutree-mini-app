'use client';

import { useEffect, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../lib/auth-context';
import { createQueryClient } from '../lib/query-client';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(createQueryClient);
  // Dấu cho e2e: chỉ sau khi React đã gắn xong thì ô nhập, nút mới nhận sự kiện; thao tác sớm hơn bị nuốt và ca chập chờn.
  useEffect(() => {
    document.body.dataset.hydrated = 'true';
  }, []);
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
