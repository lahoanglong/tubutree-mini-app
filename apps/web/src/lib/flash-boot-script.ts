import { FLASH_EXPECT_WINDOW_MS, FLASH_HINT_KEY } from '@tubutree/app-core/home-layout';

// Hai đoạn chạy ngay khi trình duyệt đọc tới chúng, trước lần vẽ đầu: sau lần vẽ đầu mà hydrate mới sửa thì cả trang nhảy. Mỗi đoạn tác động lên phần tử
// đứng ngay trước nó (anh em liền trước) rồi thôi; React hydrate xong sẽ gỡ cả hai.

const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

/**
 * Trang ISR có thể được phát sau giờ hết suất (kệ vẽ trong HTML dựng cách đó tới 5 phút): ẩn kệ nếu số suất còn giờ theo đồng hồ máy dưới mức tối thiểu của kệ.
 * Cùng phép tính với `FlashSale` lúc hydrate (đồng hồ máy, chưa có độ lệch giờ máy chủ), nên kệ không hiện rồi biến mất.
 */
export function flashShelfGuardScript(endAts: readonly string[], minItems: number): string {
  return `(function(){var s=document.currentScript,e=s&&s.previousElementSibling,a=${json(endAts)},n=0,t=Date.now(),i;if(!e)return;for(i=0;i<a.length;i++)if(Date.parse(a[i])>t)n++;if(n<${Number(minItems)})e.style.display="none"})()`;
}

/**
 * HTML dựng khi chưa có suất nào, mà lần mở trước máy ghi "suất kế mở lúc T" (xem `readFlashExpected`) và T đã tới: suất mới sắp về, hiện khung giữ chỗ
 * ngay lần vẽ đầu để nó về không đẩy trang. Cùng ngưỡng với `readFlashExpected`.
 */
export function flashReserveScript(): string {
  return `(function(){var s=document.currentScript,e=s&&s.previousElementSibling,m,t,n=Date.now();if(!e)return;try{m=/^0@(\\d{1,15})$/.exec(localStorage.getItem(${json(FLASH_HINT_KEY)}));t=m&&+m[1];if(m&&n>=t&&n<t+${FLASH_EXPECT_WINDOW_MS})e.style.display="block"}catch(x){}})()`;
}
