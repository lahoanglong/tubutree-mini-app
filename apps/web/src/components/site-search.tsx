'use client';

import { Suspense, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { COMBOBOX_CLOSED, comboboxKey, suggestOptions, type ComboboxState } from '@tubutree/app-core/browse/combobox';
import { categoriesQuery } from '@tubutree/app-core/queries/catalog';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { HEADER_LISTBOX_ID, HeaderSuggestPanel, headerOptionId, type HeaderOption } from '@/components/catalog/header-suggest';
import { announcePdpNavigation } from '@/components/skeletons/pdp-nav-event';
import { browseText } from '@/lib/browse-text';
import { categoryEntries } from '@/lib/browse-categories';
import { SEARCH_MAX_LENGTH, normalizeSearchQuery } from '@/lib/catalog-filter';
import { coreHttp } from '@/lib/core-http';
import { pushRecentSearch, readRecentSearches } from '@/lib/recent-searches';
import { BROWSE_PATH, EMPTY_SEARCH_STATE, browseHref } from '@/lib/search-state';
import { tenantSubdomainOf } from '@/lib/site';
import { usePopularSearches, useHeaderSuggest } from '@/lib/use-suggest';
import { foldVietnamese } from '@/lib/vn-fold';

const INPUT_ID = 'site-search-q';

const FIELD_CLASS =
  'min-h-11 min-w-0 flex-1 rounded-control border border-stone-450 bg-stone-0 px-3 text-sm text-stone-900 placeholder:text-stone-500';

/**
 * Ô tìm kiếm sản phẩm ở header khách. Là form GET về `/san-pham` nên vẫn tìm được khi JS chưa chạy; khi đã có JS
 * thì điều hướng mềm và có hộp gợi ý (combobox) cùng dữ liệu, thứ tự với gợi ý của trang Danh mục. Từ khoá rỗng thì không làm gì
 * (không đưa khách sang trang danh mục chỉ vì bấm nhầm nút). Thanh đầu chỉ hiện từ md nên hộp gợi ý cũng chỉ có từ md.
 *
 * Trên host gian hàng CTV, `/` bị rewrite sang /s/{subdomain} và bỏ qua ?q= nên không hiển thị ô này. Trên /san-pham ô này
 * vẫn hiện (luôn có đường tìm kiếm trên thanh đầu); ô tìm riêng của trang Danh mục (kèm gợi ý) chỉ dựng dưới md, nơi header ẩn,
 * nên không có hai ô trùng tên cùng lúc.
 */
export default function SiteSearch() {
  const [onTenantHost, setOnTenantHost] = useState(false);
  useEffect(() => {
    setOnTenantHost(tenantSubdomainOf(window.location.host) !== null);
  }, []);
  if (onTenantHost) return null;

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

  const [combo, setCombo] = useState<ComboboxState>(COMBOBOX_CLOSED);
  const [recent, setRecent] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const categoriesQ = useQuery({ ...categoriesQuery(coreHttp), staleTime: 60_000, retry: false, enabled: combo.open });
  const popular = usePopularSearches(combo.open);
  const suggest = useHeaderSuggest(value, combo.open);
  const options: HeaderOption[] = combo.open
    ? suggestOptions({ draft: value, recent, popular, categories: categoryEntries(categoriesQ.data), products: suggest.data?.items ?? [], fold: foldVietnamese })
    : [];
  const shown = options.length > 0;
  const active = shown && combo.active < options.length ? combo.active : -1;
  // Chạm/bấm ngoài form thì đóng; bấm trong hộp đã bị chặn `mousedown` nên tiêu điểm vẫn ở ô.
  useEffect(() => {
    if (!shown) return;
    const onDown = (e: PointerEvent) => {
      if (!formRef.current?.contains(e.target as Node)) setCombo(COMBOBOX_CLOSED);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [shown]);

  const search = (term: string) => {
    const q = normalizeSearchQuery(term);
    setCombo(COMBOBOX_CLOSED);
    if (!q) return;
    if (q.length >= 2) pushRecentSearch(q);
    setValue(q);
    router.push(browseHref({ ...EMPTY_SEARCH_STATE, q }));
  };
  const pick = (i: number) => {
    const o = options[i];
    if (!o) return;
    setCombo(COMBOBOX_CLOSED);
    if (o.kind === 'category') {
      router.push(browseHref({ ...EMPTY_SEARCH_STATE, ...(o.entry.kind === 'category' ? { category: o.entry.key } : { segment: o.entry.key }) }));
    } else if (o.kind === 'product') {
      const href = `/san-pham/${encodeURIComponent(o.product.slug)}`;
      announcePdpNavigation(href);
      router.push(href);
    } else {
      search(o.term);
    }
  };
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    search(value);
  };

  const meta = suggest.data;
  return (
    <SearchFormShell
      formRef={formRef}
      onSubmit={onSubmit}
      value={value}
      onChange={(v) => {
        setValue(v);
        setCombo({ open: true, active: -1 });
      }}
      inputRef={inputRef}
      inputProps={{
        role: 'combobox',
        'aria-autocomplete': 'list',
        'aria-expanded': shown,
        ...(shown ? { 'aria-controls': HEADER_LISTBOX_ID } : {}),
        ...(active >= 0 ? { 'aria-activedescendant': headerOptionId(active) } : {}),
        onFocus: () => {
          setRecent(readRecentSearches());
          setCombo({ open: true, active: -1 });
        },
        onBlur: () => setCombo(COMBOBOX_CLOSED),
        onKeyDown: (e) => {
          // Đang gõ dấu bằng bộ gõ (IME): Enter/mũi tên thuộc về bộ gõ, không thuộc hộp gợi ý.
          if (e.nativeEvent.isComposing) return;
          const step = comboboxKey({ open: shown, active }, e.key, options.length);
          if (step.preventDefault) e.preventDefault();
          if (step.effect === 'pick') pick(active);
          else setCombo(step.state);
        },
      }}
    >
      {shown && (
        <HeaderSuggestPanel
          options={options}
          active={active}
          stale={suggest.stale}
          productsTitle={meta?.corrected && meta.didYouMean ? fillCopy('search.showingFor', { q: meta.didYouMean }) : browseText.suggest.products}
          error={suggest.isError}
          onRetry={suggest.refetch}
          onPick={pick}
          onHover={(i) => setCombo({ open: true, active: i })}
        />
      )}
    </SearchFormShell>
  );
}

function SearchFormShell({
  onSubmit,
  value,
  onChange,
  inputRef,
  formRef,
  inputProps,
  children,
}: {
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  value?: string;
  onChange?: (v: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  formRef?: Ref<HTMLFormElement>;
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
  children?: ReactNode;
}) {
  const controlled = value !== undefined && onChange !== undefined;
  return (
    <form ref={formRef} role="search" action={BROWSE_PATH} method="get" onSubmit={onSubmit} className="relative flex min-w-0 flex-1 items-center gap-2">
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
        {...inputProps}
      />
      <button
        type="submit"
        aria-label="Tìm kiếm"
        className="flex h-11 w-11 flex-none items-center justify-center rounded-control bg-forest-600 text-stone-0 shadow-card transition hover:bg-forest-700 active:scale-95"
      >
        <Search className="h-5 w-5" aria-hidden="true" />
      </button>
      {children}
    </form>
  );
}
