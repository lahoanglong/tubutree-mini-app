'use client';

import { Suspense, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type Ref } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { SEARCH_MAX_LENGTH, normalizeSearchQuery } from '@/lib/catalog-filter';
import { BROWSE_PATH, EMPTY_SEARCH_STATE, browseHref } from '@/lib/search-state';
import { tenantSubdomainOf } from '@/lib/site';
import { useShellPathname } from '@/lib/shell-pathname';

const INPUT_ID = 'site-search-q';

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
  const onBrowsePage = useShellPathname() === BROWSE_PATH;
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

/** Khung chờ của HTML server (cùng id) còn trên trang lúc ô thật dựng ở trình duyệt; null khi không có (điều hướng mềm). */
function findShellInput(): { el: HTMLInputElement; focused: boolean } | null {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById(INPUT_ID);
  return el instanceof HTMLInputElement ? { el, focused: document.activeElement === el } : null;
}

function UrlSyncedSearch() {
  const urlQuery = useSearchParams().get('q') ?? '';
  const router = useRouter();
  // Ô này chỉ dựng ở trình duyệt rồi thay khung chờ: chữ khách đã kịp gõ vào khung chờ (máy chậm) không được mất, Enter ngay sau đó vẫn tìm đúng.
  const [shell] = useState(findShellInput);
  const [value, setValue] = useState(() => shell?.el.value || urlQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!shell || !input) return;
    // Đọc lại sau khi thay: lúc React còn đang dựng, khách vẫn gõ tiếp được vào khung chờ.
    const typed = shell.el.value;
    if (typed && typed !== input.value) {
      input.value = typed;
      setValue(typed);
    }
    if (!shell.focused) return;
    input.focus();
    const caret = shell.el.selectionStart ?? typed.length;
    input.setSelectionRange(caret, caret);
  }, [shell]);
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
    <SearchFormShell onSubmit={onSubmit} value={value} onChange={setValue} inputRef={inputRef} />
  );
}

function SearchFormShell({
  onSubmit,
  value,
  onChange,
  inputRef,
}: {
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  value?: string;
  onChange?: (v: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const controlled = value !== undefined && onChange !== undefined;
  return (
    <form role="search" action={BROWSE_PATH} method="get" onSubmit={onSubmit} className="flex min-w-0 flex-1 items-center gap-2">
      <label htmlFor={INPUT_ID} className="sr-only">
        Tìm sản phẩm
      </label>
      <input
        ref={inputRef}
        id={INPUT_ID}
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
