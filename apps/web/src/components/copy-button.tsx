'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { copyText } from '@/lib/copy-text';

/**
 * Nút chữ "Sao chép" có viền. Chỉ đổi sang "Đã chép" khi chữ thật sự vào clipboard (`copyText` có phương án hai cho webview chặn `navigator.clipboard`);
 * `onResult` báo kết quả cho nơi dùng (vd khung chuyển khoản hiện hộp nổi "Đã sao chép …" hoặc lời báo chép tay).
 */
export function CopyButton({ text, label = 'Sao chép', onResult }: { text: string; label?: string; onResult?: (ok: boolean) => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
    onResult?.(ok);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={`${copied ? 'Đã chép' : label}: ${text}`}
      className="inline-flex min-h-11 items-center gap-1 rounded-control border border-stone-450 bg-stone-0 px-3 text-xs font-semibold text-stone-700 shadow-card transition hover:bg-stone-50 active:scale-95"
      title={`Sao chép: ${text}`}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-success-fg" aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-stone-500" aria-hidden="true" />
      )}
      <span>{copied ? 'Đã chép' : label}</span>
    </button>
  );
}
