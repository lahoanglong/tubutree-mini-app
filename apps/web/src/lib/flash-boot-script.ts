// Đoạn chạy ngay khi trình duyệt đọc tới chúng, trước lần vẽ đầu: sau lần vẽ đầu mà hydrate mới sửa thì cả trang nhảy. Nó nằm cuối khối
// và chỉ tác động lên khối chứa nó; React hydrate xong sẽ gỡ nó.

const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

/**
 * Trang ISR có thể được phát sau giờ hết suất (kệ vẽ trong HTML dựng cách đó tới 5 phút): ẩn kệ nếu số suất còn giờ theo đồng hồ máy dưới mức tối thiểu của kệ.
 * Cùng phép tính với `FlashSale` lúc hydrate (đồng hồ máy, chưa có độ lệch giờ máy chủ), nên kệ không hiện rồi biến mất.
 */
export function flashShelfGuardScript(endAts: readonly string[], minItems: number): string {
  return `(function(){var s=document.currentScript,e=s&&s.parentElement,a=${json(endAts)},n=0,t=Date.now(),i;if(!e)return;for(i=0;i<a.length;i++)if(Date.parse(a[i])>t)n++;if(n<${Number(minItems)})e.style.display="none"})()`;
}
