'use client';

import dynamic from 'next/dynamic';

/**
 * Hai sheet chỉ mở sau khi khách bấm (Mua lại, Định kỳ) tải lười từ một chỗ: kệ Mua lại nằm trong JS tải lần đầu của Trang chủ, mà mỗi lời gọi
 * `next/dynamic` riêng thêm một chunk và một dòng id chunk vào webpack runtime của MỌI trang. Khi chưa tải xong, sheet chưa vẽ gì, giống sheet đang đóng.
 */
export const ReorderSheetLazy = dynamic(() => import('./reorder-sheet').then((m) => m.ReorderSheet), { ssr: false });
export const SubscribeSheetLazy = dynamic(() => import('@/app/san-pham/[slug]/subscribe-sheet').then((m) => m.SubscribeSheet), { ssr: false });
