'use client';

import { useState } from 'react';
import { ui } from '@/lib/guest-ui';

/** Chép mã vận đơn để dán vào trang hãng; trình duyệt chặn clipboard thì nhắc khách chép tay. */
export function CopyShippingCode({ code }: { code: string }) {
  const [result, setResult] = useState<'ok' | 'fail' | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setResult('ok');
    } catch {
      setResult('fail');
    }
  };
  return (
    <>
      <button type="button" onClick={() => void copy()} className={ui.btnSecondary}>
        Chép mã
      </button>
      {result && (
        <span role="status" className={`basis-full text-xs ${result === 'ok' ? 'text-success-fg' : 'text-danger-fg'}`}>
          {result === 'ok' ? 'Đã sao chép mã vận đơn' : 'Không sao chép được — hãy chép mã thủ công.'}
        </span>
      )}
    </>
  );
}
