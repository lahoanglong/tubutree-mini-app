// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { Truck, Zap } from 'lucide-react';
import { click } from '@/test-utils/dom';
import { act } from 'react';
import { mount } from './harness';
import { Card } from './card';
import { ListRow } from './list-row';
import { Badge, StatusPill } from './badge';
import { Chip } from './chip';
import { TierBadge } from './tier-badge';
import { Avatar, CountdownChip, FlashBadge, StatTile } from './tiles';
import { ProgressBar } from './progress-bar';
import { Skeleton, ProductGridSkeleton } from './skeleton';
import { EmptyState } from './empty-state';
import { StickyActionBar } from './sticky-action-bar';

describe('Card', () => {
  it('raised có bóng, outline có viền, flat nền phụ; đệm mặc định 12', () => {
    const raised = mount(<Card>a</Card>).container.firstElementChild as HTMLElement;
    expect(raised.style.boxShadow).toBe('var(--elevation-1)');
    expect(raised.style.borderRadius).toBe('var(--radius-card)');
    expect((raised.firstElementChild as HTMLElement).style.padding).toBe('12px');
    expect((mount(<Card variant="outline">a</Card>).container.firstElementChild as HTMLElement).style.border).toContain('var(--color-border-subtle)');
    expect((mount(<Card variant="flat" padding={0}>a</Card>).container.firstElementChild as HTMLElement).style.background).toBe('var(--color-bg-subtle)');
  });

  it('có onPress thì là role=button bấm được', () => {
    const onPress = vi.fn();
    const el = mount(<Card onPress={onPress}>x</Card>).container.firstElementChild as HTMLElement;
    expect(el.getAttribute('role')).toBe('button');
    click(el);
    expect(onPress).toHaveBeenCalled();
    expect(mount(<Card>x</Card>).container.firstElementChild!.getAttribute('role')).toBeNull();
  });
});

describe('ListRow', () => {
  it('hiện tiêu đề, mô tả, chevron; tối thiểu 44px', () => {
    const c = mount(<ListRow title="Địa chỉ" subtitle="3 địa chỉ" trailing="chevron" />).container;
    expect(c.textContent).toBe('Địa chỉ3 địa chỉ');
    expect(c.querySelector('svg')).not.toBeNull();
    expect((c.firstElementChild as HTMLElement).style.minHeight).toBe('44px');
    expect(c.firstElementChild!.getAttribute('role')).toBeNull();
  });

  it('có onPress thì bấm cả hàng, Enter/Space cũng kích hoạt; destructive đổi tông chữ', () => {
    const onPress = vi.fn();
    const row = mount(<ListRow title="Đăng xuất" destructive onPress={onPress} />).container.firstElementChild as HTMLElement;
    expect(row.getAttribute('role')).toBe('button');
    expect(row.tabIndex).toBe(0);
    click(row);
    act(() => { row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    act(() => { row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); });
    expect(onPress).toHaveBeenCalledTimes(3);
    expect((Array.from(row.querySelectorAll('div')).filter((d) => d.textContent === 'Đăng xuất').pop() as HTMLElement).style.color).toBe('var(--color-text-danger)');
  });
});

describe('Badge / Chip / TierBadge', () => {
  it('Badge dùng cặp màu theo tông, icon ẩn khỏi trình đọc màn hình, StatusPill là bí danh', () => {
    const el = mount(<Badge tone="success" icon={Truck}>Đang giao</Badge>).container.firstElementChild as HTMLElement;
    expect(el.style.background).toBe('var(--color-status-success-bg)');
    expect(el.style.color).toBe('var(--color-status-success-fg)');
    expect(el.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(el.textContent).toBe('Đang giao');
    expect(StatusPill).toBe(Badge);
    expect((mount(<Badge>x</Badge>).container.firstElementChild as HTMLElement).style.background).toBe('var(--color-status-neutral-bg)');
  });

  it('Chip là nút aria-pressed, vùng chạm 44px, đếm số, bấm gọi onPress', () => {
    const onPress = vi.fn();
    const b = mount(<Chip selected count={3} onPress={onPress}>Tubu</Chip>).container.querySelector('button')!;
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(b.className).toContain('tubu-hit-44');
    expect(b.style.minHeight).toBe('44px');
    expect(b.style.minWidth).toBe('44px');
    expect(b.style.background).toBe('var(--color-action-primary-bg)');
    expect(b.textContent).toBe('Tubu(3)');
    click(b);
    expect(onPress).toHaveBeenCalled();
    const off = mount(<Chip ariaLabel="Bỏ lọc Tubu" size="sm">Tubu</Chip>).container.querySelector('button')!;
    expect(off.getAttribute('aria-pressed')).toBeNull();
    expect(off.getAttribute('aria-label')).toBe('Bỏ lọc Tubu');
    expect(off.style.minHeight).toBe('32px');
  });

  it('TierBadge hiện emoji (ẩn khỏi trình đọc) và tên bậc', () => {
    const c = mount(<TierBadge name="Vàng" emoji="🥇" />).container;
    expect(c.textContent).toBe('🥇Vàng');
    expect(c.querySelector('[aria-hidden]')!.textContent).toBe('🥇');
  });
});

describe('Tiles', () => {
  it('StatTile hiện giá trị, nhãn, delta; có onPress thì là nút', () => {
    const onPress = vi.fn();
    const el = mount(<StatTile label="Đơn" value="12" delta="+2" onPress={onPress} />).container.firstElementChild as HTMLElement;
    expect(el.textContent).toBe('12Đơn+2');
    expect(el.getAttribute('role')).toBe('button');
    click(el);
    expect(onPress).toHaveBeenCalled();
  });

  it('FlashBadge, CountdownChip mang hạn kết thúc; Avatar rơi về chữ cái đầu khi không có ảnh', () => {
    expect(mount(<FlashBadge label="Giờ vàng" />).container.textContent).toBe('Giờ vàng');
    expect(mount(<CountdownChip endsAt="2026-10-20T00:00:00Z" />).container.firstElementChild!.getAttribute('data-ends-at')).toBe('2026-10-20T00:00:00Z');
    expect(mount(<Avatar fallback="long" />).container.textContent).toBe('L');
    expect(mount(<Avatar fallback="long" src="/a.png" />).container.querySelector('img')!.getAttribute('src')).toBe('/a.png');
  });
});

describe('ProgressBar / Skeleton', () => {
  it('ProgressBar kẹp phần trăm trong 0..100 và đổi màu theo tông', () => {
    const fill = (v: number, tone?: 'flash') => mount(<ProgressBar value={v} max={10} tone={tone} ariaLabel="Tiến độ thử" />).container.querySelector('[data-testid="progress-fill"]') as HTMLElement;
    expect(fill(5).style.width).toBe('50%');
    expect(fill(50).style.width).toBe('100%');
    expect(fill(-3).style.width).toBe('0%');
    expect(fill(5, 'flash').style.background).toBe('var(--color-flash-solid-bg)');
    expect(mount(<ProgressBar value={1} max={2} label="Tiến độ" />).container.textContent).toBe('Tiến độ');
  });

  it('Skeleton ẩn khỏi trình đọc màn hình; lưới có số thẻ theo count', () => {
    const el = mount(<Skeleton width={56} height={11} />).container.firstElementChild as HTMLElement;
    expect(el.className).toBe('tubu-skeleton');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.style.width).toBe('56px');
    expect(mount(<ProductGridSkeleton count={4} />).container.querySelectorAll('.tubu-skeleton').length).toBe(4 * 5);
  });
});

describe('EmptyState', () => {
  it('hiện tiêu đề, mô tả và nút; bấm nút gọi onCta', () => {
    const onCta = vi.fn();
    const c = mount(<EmptyState art="basket" heading="Giỏ hàng trống" body="Thêm sản phẩm nhé" ctaLabel="Mua sắm" onCta={onCta} />).container;
    expect(c.textContent).toContain('Giỏ hàng trống');
    expect(c.textContent).toContain('Thêm sản phẩm nhé');
    expect(c.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    click(c.querySelector('button'));
    expect(onCta).toHaveBeenCalled();
  });

  it('không có CTA thì không vẽ nút; ctaLoading hiện spinner mà nút không disabled', () => {
    expect(mount(<EmptyState art="leaf" heading="x" />).container.querySelector('button')).toBeNull();
    const b = mount(<EmptyState art="box" heading="x" ctaLabel="Thử" onCta={() => {}} ctaLoading />).container.querySelector('button')!;
    expect(b.disabled).toBe(false);
    expect(b.className).toContain('zaui-btn-loading');
  });

  it('variant inline đệm hẹp hơn variant page', () => {
    expect((mount(<EmptyState art="leaf" heading="x" variant="inline" />).container.firstElementChild as HTMLElement).style.padding).toBe('16px');
    expect((mount(<EmptyState art="leaf" heading="x" />).container.firstElementChild as HTMLElement).style.padding).toBe('40px 32px');
  });
});

describe('StickyActionBar', () => {
  it('dính đáy, chừa safe-area đáy một lần, chứa tóm tắt + nút phụ + nút chính', () => {
    const c = mount(<StickyActionBar summary={<span>Tổng</span>} secondary={<button>Giỏ</button>} primary={<button>Mua</button>} />).container;
    const bar = c.querySelector('[data-testid="sticky-bar"]') as HTMLElement;
    expect(bar.style.position).toBe('fixed');
    expect(bar.style.paddingBottom).toBe('calc(16px + var(--safe-bottom))');
    expect(bar.className).toBe('tubu-sticky-bar');
    expect(bar.textContent).toBe('TổngGiỏMua');
  });
});

describe('icon trong Badge nhận Zap', () => {
  it('icon lucide tuỳ ý', () => {
    expect(mount(<Badge tone="promo" size="sm" icon={Zap}>-10%</Badge>).container.querySelector('svg')!.getAttribute('width')).toBe('12');
  });
});

describe('ProgressBar có tên đọc được', () => {
  it('render role="progressbar" kèm tên từ ariaLabel hoặc label', () => {
    const a = mount(<ProgressBar value={1} max={4} ariaLabel="Bước 1 trên 4" />).container.querySelector('[role="progressbar"]')!;
    expect(a.getAttribute('aria-label')).toBe('Bước 1 trên 4');
    const b = mount(<ProgressBar value={1} max={4} label="Tiến độ nhiệm vụ" />).container.querySelector('[role="progressbar"]')!;
    expect(b.getAttribute('aria-label')).toBe('Tiến độ nhiệm vụ');
  });
});
