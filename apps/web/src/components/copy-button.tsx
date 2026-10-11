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
