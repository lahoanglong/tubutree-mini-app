import { useEffect, useState } from 'react';

/**
 * Chiều cao thanh đầu trang của site (sticky top-0, hai hàng ở điện thoại): khối dính của trang phải đặt dưới nó,
 * nếu không trượt vào sau header và bị che.
 */
export function useHeaderOffset(): number {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const header = document.querySelector('header');
    if (!header) return;
    const measure = () => setOffset(Math.round(header.getBoundingClientRect().height));
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(header);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, []);
  return offset;
}
