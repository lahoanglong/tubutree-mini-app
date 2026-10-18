'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { SEARCH_MAX_LENGTH, normalizeSearchQuery } from '@/lib/catalog-filter';
import { BROWSE_PATH, EMPTY_SEARCH_STATE, browseHref } from '@/lib/search-state';
import { tenantSubdomainOf } from '@/lib/site';

const FIELD_CLASS =
  'min-h-11 min-w-0 flex-1 rounded-control border border-stone-450 bg-stone-0 px-3 text-sm text-stone-900 placeholder:text-stone-500';

/**
 * Ô tìm kiếm sản phẩm ở header khách. Là form GET về `/san-pham` nên vẫn tìm được khi JS chưa chạy; khi đã có JS
 * thì điều hướng mềm. Từ khoá rỗng thì không làm gì (không đưa khách sang trang danh mục chỉ vì bấm nhầm nút).
 *
 * Trên host gian hàng CTV, `/` bị rewrite sang /s/{subdomain} và bỏ qua ?q= nên không hiển thị ô này. Trên chính
 * /san-pham cũng ẩn: trang đó có ô tìm riêng kèm gợi ý, hai ô trùng tên sẽ làm trình đọc màn hình đọc đôi.
 */
export default function SiteSearch() {
  const onBrowsePage = usePathname() === BROWSE_PATH;
  const [onTenantHost, setOnTenantHost] = useState(false);
  useEffect(() => {
    setOnTenantHost(tenantSubdomainOf(window.location.host) !== null);
  }, []);
  if (onTenantHost || onBrowsePage) return null;

  // useSearchParams buộc trang tĩnh phải có Suspense; khung chờ vẫn là form GET dùng được khi chưa có JS.
  return (
    <Suspense fallback={<SearchFormShell />}>
      <UrlSyncedSearch />
    </Suspense>
  );
}

function UrlSyncedSearch() {
  const urlQuery = useSearchParams().get('q') ?? '';
  const router = useRouter();
  const [value, setValue] = useState(urlQuery);
  // Điều hướng mềm đổi ?q= (gửi tìm kiếm, "Xóa tìm kiếm") thì ô nhập theo URL; không dùng effect để
  // ô nhập không mất focus lúc khách vừa bấm gửi.
  const [seenQuery, setSeenQuery] = useState(urlQuery);
  if (seenQuery !== urlQuery) {
    setSeenQuery(urlQuery);
    setValue(urlQuery);
  }

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = normalizeSearchQuery(value);
    if (q) router.push(browseHref({ ...EMPTY_SEARCH_STATE, q }));
  };

  return (
    <SearchFormShell onSubmit={onSubmit} value={value} onChange={setValue} />
  );
}

function SearchFormShell({
  onSubmit,
  value,
  onChange,
}: {
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  value?: string;
  onChange?: (v: string) => void;
}) {
  const controlled = value !== undefined && onChange !== undefined;
  return (
    <form role="search" action={BROWSE_PATH} method="get" onSubmit={onSubmit} className="flex min-w-0 flex-1 items-center gap-2">
      <label htmlFor="site-search-q" className="sr-only">
        Tìm sản phẩm
      </label>
      <input
        id="site-search-q"
        type="search"
        name="q"
        {...(controlled ? { value, onChange: (e) => onChange(e.target.value) } : { defaultValue: '' })}
        maxLength={SEARCH_MAX_LENGTH}
        placeholder="Tìm sản phẩm…"
        autoComplete="off"
        enterKeyHint="search"
        className={FIELD_CLASS}
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
