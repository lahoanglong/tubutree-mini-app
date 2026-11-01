import type { CSSProperties } from 'react';

/** Thẻ cách mép trang 16px, cách thẻ kế 12px — dùng chung cho mọi khối trong trang. */
export const CARD_MARGIN: CSSProperties = { margin: '0 16px 12px' };

/** Form dài trong sheet: giới hạn chiều cao để sheet không phủ kín tới đỉnh màn hình. */
export const SCROLL_BODY: CSSProperties = { maxHeight: '70vh', overflowY: 'auto', overscrollBehavior: 'contain' };
