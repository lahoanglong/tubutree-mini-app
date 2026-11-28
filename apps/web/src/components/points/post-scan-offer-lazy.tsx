'use client';

import dynamic from 'next/dynamic';

/**
 * Một điểm tải lười cho thẻ gợi ý sau khi quét (w55-01), như `repurchase-due-card-lazy.tsx`: chỉ khách vừa gửi mã thành công mới cần, nên không vào gói của `/quet-ma`.
 * Không vẽ ở máy chủ: thẻ chỉ hiện sau khi có kết quả gửi mã.
 */
export const PostScanOffer = dynamic(() => import('./post-scan-offer'), { ssr: false });
