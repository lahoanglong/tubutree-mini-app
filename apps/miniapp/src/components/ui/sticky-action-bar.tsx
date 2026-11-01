import { useEffect, useRef, type ReactNode } from 'react';

export interface StickyActionBarProps {
  primary: ReactNode;
  secondary?: ReactNode;
  summary?: ReactNode;
  /** Khối bên trái nút chính, CÙNG HÀNG với nút (vd tổng tiền của giỏ): nút giữ bề rộng riêng, khối này lấy phần còn lại. */
  lead?: ReactNode;
  /** Đệm và khoảng cách gọn (10px / 4px) cho thanh nhiều lớp như chân dính giỏ; mặc định giữ 16px / 8px của các trang khác. */
  dense?: boolean;
}

// Biến `--sticky-bar-h` nằm ở <html> nên dùng chung cho cả cây. AnimationRoutes (react-transition-group) gắn trang MỚI rồi mới tháo trang cũ
// sau hiệu ứng thoát (PDP/Thanh toán → Giỏ, hoặc Quay lại), nên thanh của trang cũ tháo SAU thanh của trang mới: tháo mà xoá biến vô điều kiện
// thì trang mới mất giá trị và ResizeObserver không bắn lại vì thanh mới không đổi cỡ. Giữ danh sách thanh đang gắn theo thứ tự gắn; chỉ thanh
// gắn sau cùng được ghi biến, thanh nào tháo thì biến trả về cho thanh còn lại (hết thanh mới xoá biến).
const mountedBars: Array<{ el: HTMLElement }> = [];

function publishBarHeight(): void {
  const root = document.documentElement;
  const top = mountedBars[mountedBars.length - 1];
  if (!top) root.style.removeProperty('--sticky-bar-h');
  else root.style.setProperty('--sticky-bar-h', `${Math.ceil(top.el.getBoundingClientRect().height)}px`);
}

/** Thanh CTA dính đáy — safe-area MỘT LẦN ở đây, không phải mỗi trang tự cộng (audit A4-21: 10
 * thanh tự vẽ, 3 thiếu safe-area hoàn toàn). */
export function StickyActionBar({ primary, secondary, summary, lead, dense }: StickyActionBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  // scroll-padding chỉ có tác dụng trên khung cuộn (.zaui-page): đánh dấu khung để Tab không để phần tử lọt dưới thanh (WCAG 2.4.11).
  useEffect(() => {
    const page = ref.current?.closest('.zaui-page');
    page?.classList.add('tubu-scroll-pad-sticky-bar');
    return () => page?.classList.remove('tubu-scroll-pad-sticky-bar');
  }, []);
  // Chiều cao thật của thanh (đã gồm safe-area và lời báo hiện thêm): trang đệm đáy theo `--sticky-bar-h` thay vì một số cứng,
  // nên thanh cao thêm hay máy có vùng an toàn đáy thì dòng cuối vẫn nằm trên thanh.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const entry = { el };
    mountedBars.push(entry);
    publishBarHeight();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (mountedBars[mountedBars.length - 1] === entry) publishBarHeight();
    });
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      mountedBars.splice(mountedBars.indexOf(entry), 1);
      publishBarHeight();
    };
  }, []);
  const pad = dense ? 10 : 16;
  return (
    <div
      ref={ref}
      data-testid="sticky-bar"
      className="tubu-sticky-bar"
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20,
        background: 'var(--color-bg-surface)', boxShadow: 'var(--elevation-3)',
        padding: `${pad}px 16px`, paddingBottom: `calc(${pad}px + var(--safe-bottom))`,
        display: 'flex', flexDirection: 'column', gap: dense ? 4 : 8,
      }}
    >
      {summary}
      {/* Có `lead` thì hàng cuối xuống dòng có chủ đích khi khối tổng không vừa (máy 320px, số tiền 9 chữ số, "Tiết kiệm 12.345.000đ"):
          `lead` grow 1000 và không bị ép min-width 0, nên nó chiếm hết chỗ và hàng chỉ xuống dòng khi chữ không ngắt được của nó rộng hơn chỗ còn lại,
          thay vì cắt hay chui dưới nút. Nút grow 1: chung hàng với `lead` thì phần dư chia 1000:1 nên giữ ~9.25rem; xuống hàng riêng thì giãn hết bề ngang. */}
      <div style={{ display: 'flex', gap: 10, alignItems: lead ? 'center' : undefined, ...(lead ? { flexWrap: 'wrap', rowGap: 'var(--space-stack-xs)' } : null) }}>
        {lead && <div style={{ flexGrow: 1000, flexShrink: 1, flexBasis: 0 }}>{lead}</div>}
        {secondary}
        {/* minWidth 0: flex item mặc định min-width:auto = bề rộng nội dung → hàng CTA không co được
            và tràn khỏi màn hình ở 320-390px (PDP "Mua ngay · giá" chạm 421px). Nút bên trong co/rút
            gọn nhờ .tubu-sticky-bar .tubu-btn (css/tokens.css). Có `lead` thì nút tự giữ bề rộng (đủ nhãn "Thanh toán (n)"). */}
        <div style={lead ? { flexGrow: 1, flexShrink: 0, flexBasis: '9.25rem' } : { flex: 1, minWidth: 0 }}>{primary}</div>
      </div>
    </div>
  );
}
