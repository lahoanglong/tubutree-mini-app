'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { SEARCH_MAX_LENGTH, homeHref, normalizeSearchQuery } from '@/lib/catalog-filter';

/**
 * Ô tìm kiếm sản phẩm ở header khách. Là form GET về `/` nên vẫn tìm được khi JS chưa chạy; khi đã có JS
 * thì điều hướng mềm kèm neo `#san-pham` để kết quả hiện ngay. Từ khoá rỗng thì không làm gì (không đưa
 * khách về trang chủ chỉ vì bấm nhầm nút).
 */
export default function SiteSearch() {
  const router = useRouter();
  const [value, setValue] = useState('');

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = normalizeSearchQuery(value);
    if (q) router.push(homeHref({ q }));
  };

  return (
    <form role="search" action="/" method="get" onSubmit={onSubmit} className="flex min-w-0 flex-1 items-center gap-2">
      <label htmlFor="site-search-q" className="sr-only">
        Tìm sản phẩm
      </label>
      <input
        id="site-search-q"
        type="search"
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={SEARCH_MAX_LENGTH}
        placeholder="Tìm sản phẩm…"
        autoComplete="off"
        enterKeyHint="search"
        className="min-h-11 min-w-0 flex-1 rounded-control border border-stone-450 bg-stone-0 px-3 text-sm text-stone-900 placeholder:text-stone-500"
      />
      <button
        type="submit"
        aria-label="Tìm kiếm"
        className="flex h-11 w-11 flex-none items-center justify-center rounded-control bg-forest-600 text-stone-0 shadow-card transition hover:bg-forest-700 active:scale-95"
      >
        <Search className="h-5 w-5" aria-hidden="true" />
      </button>
    </form>
  );
}
