'use client';

import { useEffect, useState } from 'react';

// Không truyền màu: thư viện chỉ nhận hex và không đọc được biến CSS. Mặc định của nó là đen trên trắng,
// tương phản tối đa cho máy quét, và không đổi theo theme sáng/tối.
export function QrCode({ value, size = 180, alt = 'QR' }: { value: string; size?: number; alt?: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let live = true;
    // Nạp thư viện khi cần vẽ mã: trang chỉ mở bảng chia sẻ khi bấm thì không phải tải nó ở lượt vào đầu.
    import('qrcode')
      .then((m) => m.default.toDataURL(value, { width: size, margin: 1 }))
      .then((u) => live && setUrl(u))
      .catch(() => live && setUrl(''));
    return () => {
      live = false;
    };
  }, [value, size]);
  if (!url) return <div data-qr-placeholder className="rounded-control bg-stone-100" style={{ width: size, height: size }} />;
  // eslint-disable-next-line @next/next/no-img-element -- data URL sinh tại chỗ, next/image không tối ưu được
  return <img src={url} alt={alt} width={size} height={size} className="rounded-control" />;
}
