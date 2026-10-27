import type { ReactNode } from 'react';

export const GAME_TABS = [
  { key: 'today', label: 'Hôm nay' },
  { key: 'garden', label: 'Vườn' },
  { key: 'community', label: 'Cộng đồng' },
] as const;

export type GameTabKey = (typeof GAME_TABS)[number]['key'];

export const GAME_TAB_KEYS: readonly string[] = GAME_TABS.map((t) => t.key);

/**
 * Mỗi tab là một khối luôn được dựng, chỉ ẩn khi không chọn: vòng quay đang quay và đáp án quiz đang hiện không bị
 * mất khi khách đổi tab.
 *
 * Từ lg: `split` chia cố định hai cột (việc chính 2/3, phụ 1/3 do `GameCol` đánh dấu), không để lưới tự chảy rồi
 * chừa hố trắng; `columns` xếp thẻ thành hai cột đều không hố (thẻ không bị cắt giữa chừng). Dưới lg luôn là một cột như Mini App.
 */
export function GameTabPanel({ tab, active, children, layout = 'columns' }: { tab: GameTabKey; active: boolean; children: ReactNode; layout?: 'split' | 'columns' }) {
  const label = GAME_TABS.find((t) => t.key === tab)?.label;
  const wide =
    layout === 'split'
      ? 'lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start'
      : 'lg:block lg:columns-2 lg:gap-3 lg:space-y-0 lg:[&>*]:mb-3 lg:[&>*]:break-inside-avoid';
  return (
    <div role="tabpanel" aria-label={label} hidden={!active} className={active ? `flex flex-col gap-3 ${wide}` : 'hidden'}>
      {children}
    </div>
  );
}

/**
 * Cột của tab dùng `split`. Dưới lg là `display: contents` nên con của nó vẫn là phần tử của khối một cột như trước (thứ tự giữ nguyên
 * nên không cần `order`: DOM đã theo thứ tự điện thoại); từ lg là một cột dọc đặt vào ô lưới theo `place`.
 */
export function GameCol({ children, place }: { children: ReactNode; place: string }) {
  return <div className={`contents lg:flex lg:min-w-0 lg:flex-col lg:gap-3 ${place}`}>{children}</div>;
}

/** Vị trí lưới từ lg cho ba khối của tab Hôm nay, khai báo theo THỨ TỰ DOM của điện thoại (đọc/Tab đúng như thứ tự nhìn). */
export const GAME_COL = {
  top: 'lg:col-start-1 lg:row-start-1',
  side: 'lg:col-start-2 lg:row-span-2 lg:row-start-1',
  bottom: 'lg:col-start-1 lg:row-start-2',
} as const;
