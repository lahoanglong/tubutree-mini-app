'use client';

import { Fragment, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { ChevronDown, Menu, Search } from 'lucide-react';
import { SideDrawer } from './side-drawer';

export interface NavItem<K extends string> {
  k: K;
  label: string;
  /** Từ khoá thêm cho ô "Tìm mục" (VD "ảnh" tìm ra mục Sản phẩm). */
  keywords?: string;
  /** Mục là tổng của các mục khác (VD "Hôm nay"): không cộng vào huy hiệu ở tên nhóm đang gập, kẻo một việc đếm hai lần. */
  total?: boolean;
}
export interface NavGroup<K extends string> {
  label: string;
  items: NavItem<K>[];
  /** Nhóm lối tắt (mục lặp lại từ nhóm khác): không hiện khi tìm kiếm để kết quả khỏi lặp. */
  quick?: boolean;
}

const SKIP_TARGET_ID = 'admin-main';
const SKIP_LINK_CLASS =
  'sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[110] focus:rounded-control focus:bg-stone-0 focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-forest-800 focus:shadow-raised';

/**
 * Trang đặt `id="admin-main"` cho vùng nội dung thì nhảy thẳng tới đó. Chưa đặt thì dùng phần tử anh em kế tiếp của khối
 * menu (bố cục hiện tại của trang admin), bỏ qua các phần của menu tự đánh dấu `data-admin-nav-part`.
 */
function skipToContent(e: MouseEvent<HTMLAnchorElement>) {
  let target = document.getElementById(SKIP_TARGET_ID);
  if (!target) {
    target = e.currentTarget.nextElementSibling as HTMLElement | null;
    while (target?.hasAttribute('data-admin-nav-part')) target = target.nextElementSibling as HTMLElement | null;
  }
  if (!target) return;
  e.preventDefault();
  if (!target.id) target.id = SKIP_TARGET_ID;
  target.tabIndex = -1;
  target.focus();
}

const ITEM_CLASS = 'flex min-h-[44px] w-full items-center gap-1.5 rounded-control px-3 py-2 text-left text-sm lg:min-h-[36px] lg:py-1.5';
const ITEM_ACTIVE = 'bg-forest-100 font-semibold text-forest-800';
const ITEM_IDLE = 'text-stone-700 hover:bg-stone-100';

const OPEN_KEY = 'tubu_admin_nav_open';

/** Bỏ dấu và chữ hoa để "don hang" cũng tìm ra "Đơn hàng". */
const fold = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

/**
 * Nhóm đang mở, nhớ trong trình duyệt (try/catch: chế độ riêng tư hoặc chặn lưu trữ thì dùng mặc định). Chưa từng chọn
 * thì chỉ mở nhóm đầu để menu gọn; nhóm chứa mục đang xem luôn hiện ít nhất mục đó (xem NavList).
 */
function useOpenGroups(firstGroup: string | undefined) {
  const [open, setOpen] = useState<string[] | null>(() => {
    try {
      const raw = window.localStorage.getItem(OPEN_KEY);
      const v: unknown = raw ? JSON.parse(raw) : null;
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
    } catch {
      return null;
    }
  });
  const current = open ?? (firstGroup ? [firstGroup] : []);
  const toggle = (label: string) => {
    const next = current.includes(label) ? current.filter((x) => x !== label) : [...current, label];
    setOpen(next);
    try {
      window.localStorage.setItem(OPEN_KEY, JSON.stringify(next));
    } catch {
      /* không lưu được thì lần sau về mặc định */
    }
  };
  return { open: current, toggle };
}

function NavList<K extends string>({
  groups,
  active,
  onSelect,
  badge,
  open,
  onToggle,
}: {
  groups: NavGroup<K>[];
  active: K;
  onSelect: (k: K) => void;
  badge?: (k: K) => ReactNode;
  open: string[];
  onToggle: (label: string) => void;
}) {
  const [query, setQuery] = useState('');
  const q = fold(query.trim());
  const shown = q
    ? groups
        .filter((g) => !g.quick)
        .map((g) => ({ ...g, items: g.items.filter((i) => fold(`${i.label} ${i.keywords ?? ''}`).includes(q) || fold(g.label).includes(q)) }))
        .filter((g) => g.items.length > 0)
    : groups;
  const firstMatch = q ? shown[0]?.items[0] : undefined;
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && firstMatch) {
              e.preventDefault();
              onSelect(firstMatch.k);
            }
          }}
          placeholder="Tìm mục…"
          aria-label="Tìm mục quản trị"
          className="min-h-[44px] w-full rounded-control border border-stone-450 bg-stone-0 pl-9 pr-3 text-sm text-stone-900 placeholder:text-stone-500 lg:min-h-[36px]"
        />
      </div>
      {q && shown.length === 0 && <p className="px-3 py-2 text-sm text-stone-600">Không có mục nào khớp &quot;{query.trim()}&quot;.</p>}
      {shown.map((g) => {
        const expanded = !!q || open.includes(g.label);
        const items = expanded ? g.items : g.items.filter((i) => i.k === active);
        return (
          <div key={g.label} role="group" aria-label={g.label}>
            <button
              type="button"
              aria-expanded={expanded}
              disabled={!!q}
              onClick={() => onToggle(g.label)}
              className="flex min-h-[36px] w-full items-center justify-between gap-2 rounded-control px-3 py-1 text-left text-[11px] font-semibold uppercase tracking-wider text-stone-600 hover:bg-stone-100 disabled:hover:bg-transparent"
            >
              <span className="flex min-w-0 items-center">
                {g.label}
                {/* Nhóm gập: số việc chờ của các mục đang ẩn hiện ngay ở tên nhóm, để không phải mở nhóm mới thấy. */}
                {g.items.filter((i) => !items.includes(i) && !i.total).map((i) => <Fragment key={i.k}>{badge?.(i.k)}</Fragment>)}
              </span>
              <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform ${expanded ? '' : '-rotate-90'}`} />
            </button>
            <ul className="space-y-0.5">
              {items.map((t) => (
                <li key={t.k}>
                  <button
                    type="button"
                    aria-current={active === t.k ? 'page' : undefined}
                    onClick={() => onSelect(t.k)}
                    className={`${ITEM_CLASS} ${active === t.k ? ITEM_ACTIVE : ITEM_IDLE}`}
                  >
                    {t.label}
                    {badge?.(t.k)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** Thanh mục quản trị theo nhóm: cột trái cố định từ màn lg; dưới lg là nút mở ngăn kéo (390px vẫn đủ chỗ cho nội dung). */
export function AdminNav<K extends string>({
  groups,
  active,
  onSelect,
  badge,
  summaryBadge,
}: {
  groups: NavGroup<K>[];
  active: K;
  onSelect: (k: K) => void;
  badge?: (k: K) => ReactNode;
  /** Điện thoại: một huy hiệu tổng cạnh nút "Đổi mục" (thay cho huy hiệu từng mục) khi ngăn kéo đang đóng. */
  summaryBadge?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const nav = useOpenGroups(groups[0]?.label);
  const listRef = useRef<HTMLDivElement>(null);
  // Mở thẳng tab ở cuối menu (?tab=config) thì mục đang chọn nằm ngoài khung cuộn. Chỉ cuộn khung menu, không dùng
  // scrollIntoView: nó kéo cả cửa sổ xuống và đẩy tiêu đề của tab ra khỏi màn hình.
  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !item) return;
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top >= list.scrollTop && bottom <= list.scrollTop + list.clientHeight) return;
    list.scrollTop = top - (list.clientHeight - item.offsetHeight) / 2;
  }, [active]);
  const current = groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label }))).find((i) => i.k === active);
  return (
    <>
      <a href={`#${SKIP_TARGET_ID}`} data-admin-nav-part onClick={skipToContent} className={SKIP_LINK_CLASS}>
        Bỏ qua tới nội dung
      </a>
      <nav aria-label="Mục quản trị" data-admin-nav-part className="hidden w-60 shrink-0 lg:block">
        <div ref={listRef} className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-card border border-stone-200 bg-stone-0 p-2 shadow-card">
          <NavList groups={groups} active={active} onSelect={onSelect} badge={badge} open={nav.open} onToggle={nav.toggle} />
        </div>
      </nav>
      <div data-admin-nav-part className="sticky z-30 -mx-4 border-b border-stone-200 bg-stone-50 px-4 py-2 lg:hidden" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="flex min-h-[44px] w-full items-center gap-2 rounded-control border border-stone-450 bg-stone-0 px-3 text-left text-sm"
        >
          <Menu aria-hidden="true" className="h-5 w-5 shrink-0 text-stone-600" />
          <span className="min-w-0 flex-1 truncate">
            <span className="text-stone-500">{current?.group ?? 'Mục'} · </span>
            <span className="font-semibold text-stone-900">{current?.label ?? 'Chọn mục'}</span>
          </span>
          {/* Ngăn kéo đóng: số việc chờ vẫn hiện ở nút, không phải mở menu mới thấy. */}
          {summaryBadge ?? [...new Set(groups.flatMap((g) => g.items.map((i) => i.k)))].map((k) => <Fragment key={k}>{badge?.(k)}</Fragment>)}
          <span className="shrink-0 text-xs font-medium text-forest-700">Đổi mục</span>
        </button>
      </div>
      {open && (
        <SideDrawer title="Mục quản trị" side="left" onClose={() => setOpen(false)}>
          <nav aria-label="Mục quản trị (điện thoại)">
            <NavList
              groups={groups}
              active={active}
              badge={badge}
              open={nav.open}
              onToggle={nav.toggle}
              onSelect={(k) => {
                setOpen(false);
                onSelect(k);
              }}
            />
          </nav>
        </SideDrawer>
      )}
    </>
  );
}
