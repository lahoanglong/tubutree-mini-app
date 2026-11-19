'use client';

import { createContext, useContext, type ReactNode } from 'react';

const RecyclePageFooterContext = createContext<ReactNode>(null);

/**
 * Khối dựng sẵn ở máy chủ (Câu hỏi thường gặp của /doi-rac) gắn vào cuối `<main>` của mọi trạng thái màn Đổi rác: màn là client và đổi
 * khung theo phiên (đang tải, khách, đã đăng nhập), nên trang truyền khối qua context thay vì xuyên props qua từng nhánh. Khối nằm trong HTML
 * ngay từ lần dựng đầu (trạng thái "đang tải" mà công cụ tìm kiếm thấy) và không phải chạy lại ở client.
 */
export function RecyclePageFooter({ footer, children }: { footer: ReactNode; children: ReactNode }) {
  return <RecyclePageFooterContext.Provider value={footer}>{children}</RecyclePageFooterContext.Provider>;
}

export const useRecyclePageFooter = (): ReactNode => useContext(RecyclePageFooterContext);
