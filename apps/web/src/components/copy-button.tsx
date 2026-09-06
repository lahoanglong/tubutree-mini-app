'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export function CopyButton({ text, label = 'Sao chép' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard error
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded-md bg-white border border-neutral-200 px-2 py-0.5 text-[11px] font-medium text-neutral-700 shadow-sm transition hover:bg-neutral-50 active:scale-95"
      title={`Sao chép: ${text}`}
    >
      {copied ? <Check className="h-3 w-3 text-leaf-600" /> : <Copy className="h-3 w-3 text-neutral-500" />}
      <span>{copied ? 'Đã chép' : label}</span>
    </button>
  );
}
