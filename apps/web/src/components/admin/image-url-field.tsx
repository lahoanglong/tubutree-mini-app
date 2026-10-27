'use client';

import { BrandImageField } from '@/components/brand-owner/brand-image-field';
import { INPUT_CLASS } from './ui';

/**
 * Ảnh bìa/logo trong quản trị: nút tải ảnh lên là đường chính, ô dán link giữ lại cho ai đã có sẵn đường link ảnh.
 * Ảnh vừa tải là đường link hoặc ảnh nén; ô link chỉ hiện chữ khi giá trị là link, để không đổ cả ảnh nén vào một ô chữ.
 */
export function ImageUrlField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const isEmbedded = value.startsWith('data:');
  return (
    <div className="space-y-1">
      <BrandImageField label={label} value={value} onChange={onChange} />
      <label className="block text-xs text-stone-600">
        Hoặc dán link ảnh
        <input
          type="url"
          inputMode="url"
          placeholder="https://…"
          aria-label={`Link ảnh ${label.toLowerCase()}`}
          value={isEmbedded ? '' : value}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT_CLASS} mt-1 min-h-[44px] sm:min-h-0`}
        />
      </label>
      {value && (
        <button type="button" onClick={() => onChange('')} className="min-h-[44px] text-xs font-medium text-stone-600 underline sm:min-h-0">
          Bỏ ảnh
        </button>
      )}
    </div>
  );
}
