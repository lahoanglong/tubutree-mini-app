'use client';

import dynamic from 'next/dynamic';

/**
 * Một điểm tải lười cho thẻ Mua lại hàng tiêu hao (Tài khoản và giỏ trống), như `green-card-lazy.tsx`: mỗi lời gọi `next/dynamic` riêng thêm một chunk và một dòng
 * id chunk vào webpack runtime mà mọi trang tải. Không vẽ ở máy chủ: thẻ đọc kho ẩn 14 ngày của trình duyệt và chỉ dành cho khách đã đăng nhập.
 */
export const RepurchaseDueCard = dynamic(() => import('./repurchase-due-card'), { ssr: false });
