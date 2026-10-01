import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate, useNavigationType, type NavigateFunction } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { EMPTY_SEARCH_STATE } from '../utils/search-state';
import { useSearchState, type UseSearchState } from './use-search-state';

let hook: UseSearchState;
let navigate: NavigateFunction;
function Probe() {
  hook = useSearchState();
  navigate = useNavigate();
  const loc = useLocation();
  const nav = useNavigationType();
  return <div data-testid="loc" data-nav={nav}>{loc.pathname + loc.search}</div>;
}
// Cờ future bật sẵn để log test sạch (không cảnh báo v7 của React Router).
const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;
const renderAt = (url: string) => render(<MemoryRouter initialEntries={[url]} future={FUTURE}><Probe /></MemoryRouter>);
const loc = () => screen.getByTestId('loc');

describe('useSearchState', () => {
  it('đọc trạng thái từ URL, kể cả link cũ ?brand= / ?segment= và ?focus=search từ Trang chủ', () => {
    renderAt('/browse?brand=Tubu,M%E1%BB%99c%20An&segment=mom_baby&focus=search');
    expect(hook.state).toEqual({ ...EMPTY_SEARCH_STATE, brands: ['Tubu', 'Mộc An'], segment: 'mom_baby' });
    expect(hook.focusSearch).toBe(true);
    expect(hook.urlKey).toBe('segment=mom_baby&brand=Tubu%2CM%E1%BB%99c+An'); // không gồm focus
  });

  it('urlKey không đổi khi chỉ khác tham số lạ / focus', () => {
    renderAt('/browse?sort=newest&q=nuoc&utm=zalo&focus=search');
    const key = hook.urlKey;
    expect(key).toBe('q=nuoc&sort=newest');
    act(() => hook.consumeFocus());
    expect(hook.urlKey).toBe(key);
  });

  it('update ghi URL bằng REPLACE (không chồng lịch sử), giữ phần còn lại, bỏ focus', () => {
    renderAt('/browse?q=nuoc&focus=search');
    act(() => hook.update({ sort: 'best_seller' }));
    expect(loc()).toHaveTextContent('/browse?q=nuoc&sort=best_seller');
    expect(loc()).toHaveAttribute('data-nav', 'REPLACE');
  });

  it('update với undefined gỡ tham số', () => {
    renderAt('/browse?minPrice=100000&maxPrice=200000&inStock=1');
    act(() => hook.update({ minPrice: undefined, maxPrice: undefined }));
    expect(loc()).toHaveTextContent(/^\/browse\?inStock=1$/);
  });

  it('update giữ tham số lạ (utm) y như consumeFocus, bỏ focus, tham số chuẩn viết lại theo thứ tự cố định', () => {
    renderAt('/browse?utm=zalo&sort=newest&q=nuoc&focus=search&ref=abc');
    act(() => hook.update({ inStock: true }));
    expect(loc()).toHaveTextContent('/browse?q=nuoc&inStock=1&sort=newest&utm=zalo&ref=abc');
    expect(loc()).toHaveAttribute('data-nav', 'REPLACE');
    expect(hook.focusSearch).toBe(false);
  });

  it('update gỡ hết bộ lọc vẫn giữ tham số lạ', () => {
    renderAt('/browse?q=nuoc&utm=zalo');
    act(() => hook.update({ q: '' }));
    expect(loc()).toHaveTextContent(/^\/browse\?utm=zalo$/);
  });

  it('update làm sạch giá trị rác của tham số chuẩn', () => {
    renderAt('/browse?sort=cheapest&q=nuoc');
    act(() => hook.update({ inStock: true }));
    expect(loc()).toHaveTextContent('/browse?q=nuoc&inStock=1');
  });

  it('consumeFocus chỉ bỏ focus (giữ cả tham số lạ như utm), dạng replace', () => {
    renderAt('/browse?q=nuoc&focus=search&utm=zalo');
    act(() => hook.consumeFocus());
    expect(loc()).toHaveTextContent('/browse?q=nuoc&utm=zalo');
    expect(loc()).toHaveAttribute('data-nav', 'REPLACE');
    expect(hook.focusSearch).toBe(false);
  });
});

describe('useSearchState — nhiều thao tác ghi trong cùng một nhịp (không mất cập nhật)', () => {
  it('hai update liên tiếp trong một act: cả hai patch còn trong URL, vẫn REPLACE, giữ tham số lạ', () => {
    renderAt('/browse?q=nuoc&utm=zalo&focus=search');
    act(() => {
      hook.update({ sort: 'best_seller' });
      hook.update({ category: 'cat-a' });
    });
    expect(loc()).toHaveTextContent('/browse?q=nuoc&category=cat-a&sort=best_seller&utm=zalo');
    expect(loc()).toHaveAttribute('data-nav', 'REPLACE');
    expect(hook.state).toMatchObject({ q: 'nuoc', sort: 'best_seller', category: 'cat-a' });
  });

  it('consumeFocus rồi update trong một act: focus bị bỏ VÀ patch được giữ', () => {
    renderAt('/browse?q=nuoc&focus=search&utm=zalo');
    act(() => {
      hook.consumeFocus();
      hook.update({ sort: 'newest' });
    });
    expect(loc()).toHaveTextContent('/browse?q=nuoc&sort=newest&utm=zalo');
    expect(loc()).toHaveAttribute('data-nav', 'REPLACE');
    expect(hook.focusSearch).toBe(false);
  });

  it('update rồi consumeFocus trong một act: patch được giữ VÀ focus bị bỏ', () => {
    renderAt('/browse?q=nuoc&focus=search&utm=zalo');
    act(() => {
      hook.update({ inStock: true });
      hook.consumeFocus();
    });
    expect(loc()).toHaveTextContent('/browse?q=nuoc&inStock=1&utm=zalo');
    expect(loc()).toHaveAttribute('data-nav', 'REPLACE');
    expect(hook.focusSearch).toBe(false);
  });

  it('điều hướng ngoài (Back/link) đổi URL → lần ghi kế tiếp xuất phát từ URL mới, không phải URL cũ', () => {
    renderAt('/browse?q=nuoc');
    act(() => {
      hook.update({ sort: 'newest' });
    });
    act(() => navigate('/browse?q=xa+phong&utm=zalo'));
    act(() => hook.update({ inStock: true }));
    expect(loc()).toHaveTextContent('/browse?q=xa+phong&inStock=1&utm=zalo');
  });

  it('sau một lô ghi, lô ghi kế tiếp (act khác) bắt đầu từ URL đã commit', () => {
    renderAt('/browse?q=nuoc');
    act(() => {
      hook.update({ sort: 'newest' });
      hook.update({ inStock: true });
    });
    act(() => hook.update({ sort: 'price_asc' }));
    expect(loc()).toHaveTextContent('/browse?q=nuoc&inStock=1&sort=price_asc');
  });
});
