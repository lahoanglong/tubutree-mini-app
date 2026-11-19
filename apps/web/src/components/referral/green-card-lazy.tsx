'use client';

import dynamic from 'next/dynamic';

/**
 * Một điểm tải lười duy nhất cho thẻ thành tích xanh (Sổ tay Xanh và khối mời ở Tài khoản): mỗi lời gọi `next/dynamic` riêng thêm một chunk và
 * một dòng id chunk vào webpack runtime mà MỌI trang tải, trong khi Trang chủ và /vuon-xanh đã sát web-budget.
 */
export const GreenCardBlock = dynamic(() => import('./green-card'), { ssr: false });
