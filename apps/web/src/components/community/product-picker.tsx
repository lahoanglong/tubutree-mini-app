'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { suggestProducts, type ProductSuggestion } from '@tubutree/app-core/api/catalog';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { cardPricing } from '@/lib/flash-price';
import { useActiveFlashSales } from '@/lib/use-flash-sales';
import { ui } from '@/lib/guest-ui';
import { safeMediaUrl } from './post-parts';
import { useDebounced } from './use-debounced';
import { foldVietnamese } from './vn-fold';
import { ProductThumb } from '@/components/mini';

const SUGGEST_MIN_CHARS = 2;
const isSuggestable = (s: string) => foldVietnamese(s).length >= SUGGEST_MIN_CHARS;

/** Chọn sản phẩm để gắn vào bài đăng cộng đồng: ô tìm + chip đã chọn (tối đa `max`). */
export function ProductPicker({ value, onChange, max = 5 }: { value: ProductSuggestion[]; onChange: (v: ProductSuggestion[]) => void; max?: number }) {
  const flash = useActiveFlashSales();
  const [q, setQ] = useState('');
  const [maxWarning, setMaxWarning] = useState(false);
  const dq = useDebounced(q, 300);

  // Cổng xét cả từ khoá đang gõ (chưa debounce): xoá bớt xuống dưới 2 ký tự thì ẩn gợi ý ngay.
  const canSuggest = isSuggestable(q) && isSuggestable(dq);
  const tooShort = q.trim() !== '' && !isSuggestable(q);
  const suggestQ = useQuery({ queryKey: ['suggest', dq], queryFn: () => suggestProducts(coreHttp, dq), enabled: canSuggest });
  const results = (suggestQ.data ?? []).filter((p) => !value.some((v) => v.slug === p.slug));

  const add = (p: ProductSuggestion) => {
    if (value.some((v) => v.slug === p.slug)) return;
    if (value.length >= max) {
      setMaxWarning(true);
      return;
    }
    setMaxWarning(false);
    onChange([...value, p]);
    setQ('');
  };
  const remove = (slug: string) => {
    setMaxWarning(false);
    onChange(value.filter((v) => v.slug !== slug));
  };

  return (
    <div className="mt-3">
      <label htmlFor="community-product-search" className="mb-1 block text-sm font-semibold text-stone-900">
        Gắn sản phẩm
      </label>
      {value.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {value.map((p) => {
            const thumb = safeMediaUrl(p.thumbnail);
            return (
              <li key={p.slug} className="flex items-center gap-1.5 rounded-control border border-stone-200 bg-stone-0 pl-2">
                <ProductThumb src={thumb} alt="" size={24} />
                <span className="max-w-[6rem] truncate text-xs text-stone-800">{p.name}</span>
                <button type="button" aria-label={`Gỡ ${p.name}`} onClick={() => remove(p.slug)} className="inline-flex h-11 min-h-11 w-11 items-center justify-center text-stone-700">
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <input
        id="community-product-search"
        type="search"
        autoComplete="off"
        placeholder="Tìm sản phẩm để gắn…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setMaxWarning(false);
        }}
        className={ui.field}
      />
      {maxWarning && <p className="mt-1 text-xs text-danger-fg">Chỉ gắn tối đa 5 sản phẩm</p>}
      {tooShort && <p className="mt-2 text-xs text-stone-600">Nhập ít nhất 2 ký tự</p>}
      {canSuggest && (
        <div className="mt-2">
          {results.map((p) => {
            const thumb = safeMediaUrl(p.thumbnail);
            return (
              <button key={p.slug} type="button" data-testid="suggestion" onClick={() => add(p)} className="flex min-h-11 w-full items-center gap-2 py-1.5 text-left">
                <ProductThumb src={thumb} alt="" size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-stone-900">{p.name}</span>
                  <span className="block text-xs font-semibold text-forest-700">{formatVnd(cardPricing(p, flash).price)}</span>
                </span>
              </button>
            );
          })}
          {results.length === 0 && !suggestQ.isFetching && <p className="py-1.5 text-xs text-stone-600">Không tìm thấy sản phẩm phù hợp</p>}
        </div>
      )}
    </div>
  );
}
