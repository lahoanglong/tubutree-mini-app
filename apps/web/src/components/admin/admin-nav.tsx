'use client';

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { SideDrawer } from './side-drawer';

export interface NavItem<K extends string> {
  k: K;
  label: string;
}
export interface NavGroup<K extends string> {
  label: string;
  items: NavItem<K>[];
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

function NavList<K extends string>({
  groups,
  active,
  onSelect,
  badge,
}: {
  groups: NavGroup<K>[];
  active: K;
  onSelect: (k: K) => void;
  badge?: (k: K) => ReactNode;
}) {
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.label} role="group" aria-label={g.label}>
          <div aria-hidden="true" className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-stone-500">
            {g.label}
          </div>
          <ul className="space-y-0.5">
            {g.items.map((t) => (
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
      ))}
    </div>
  );
}

/** Thanh mục quản trị theo nhóm: cột trái cố định từ màn lg; dưới lg là nút mở ngăn kéo (390px vẫn đủ chỗ cho nội dung). */
export function AdminNav<K extends string>({
  groups,
  active,
  onSelect,
  badge,
}: {
  groups: NavGroup<K>[];
  active: K;
  onSelect: (k: K) => void;
  badge?: (k: K) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
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
          <NavList groups={groups} active={active} onSelect={onSelect} badge={badge} />
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
