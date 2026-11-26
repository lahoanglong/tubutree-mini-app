import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const openSnackbar = vi.hoisted(() => vi.fn());
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useSnackbar: () => ({ openSnackbar }),
  useLocation: () => ({ search: routerSearch.value }),
}));
const routerSearch = vi.hoisted(() => ({ value: '' }));
const openWebPortal = vi.hoisted(() => vi.fn());
vi.mock('../services/zmp-bridge', () => ({ openWebPortal }));
const copyText = vi.hoisted(() => vi.fn());
vi.mock('../utils/clipboard', () => ({ copyText }));

import WebPortalRedirectPage from './web-portal-redirect';
import { WEB_PORTAL_SCREENS, webPortalUrl, type WebPortalScreen, type WebPortalScreenKey } from './web-portal-screens';

const KEYS = Object.keys(WEB_PORTAL_SCREENS) as WebPortalScreenKey[];
/** Màn mở được trong webview Zalo; màn `browserOnly` (chỉ /dealer) có khối kiểm riêng ở cuối tệp. */
const OPENABLE = KEYS.filter((key) => !(WEB_PORTAL_SCREENS[key] as WebPortalScreen).browserOnly);
const DEALER_NOTE = 'Đăng ký đại lý, đặt hàng sỉ và thanh toán đơn sỉ trên trình duyệt (Chrome, Safari) tại tubutree.com/dai-ly. Mini App chỉ nhận đơn lẻ.';

beforeEach(() => {
  routerSearch.value = '';
  openWebPortal.mockReset().mockResolvedValue(true);
  copyText.mockReset().mockResolvedValue(true);
  openSnackbar.mockReset();
});

describe('WebPortalRedirectPage — thẻ chuyển sang website', () => {
  it('bảy màn mở được trong Zalo, chỉ /dealer là màn chỉ mở bằng trình duyệt', () => {
    expect(KEYS.filter((key) => !OPENABLE.includes(key))).toEqual(['/dealer']);
    expect(OPENABLE).toHaveLength(7);
  });

  it.each(OPENABLE)('%s: một h1 là tiêu đề màn, nói rõ làm đầy đủ trên website và hiện link', (key) => {
    const { title, audience } = WEB_PORTAL_SCREENS[key];
    render(<WebPortalRedirectPage screen={key} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(title);
    expect(screen.getByText(new RegExp(`${audience} thao tác đầy đủ trên website`))).toBeInTheDocument();
    expect(screen.getByText(webPortalUrl(key))).toBeInTheDocument();
  });

  it('đúng hai nút (Mở trên website, Sao chép liên kết), không vẽ thêm nút Quay lại vì vỏ app đã có nút nổi', () => {
    render(<WebPortalRedirectPage screen="/admin" />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Mở trên website', 'Sao chép liên kết']);
  });

  it.each(OPENABLE)('%s: nút chính cao tối thiểu 48px khai báo và mở đúng link web', async (key) => {
    render(<WebPortalRedirectPage screen={key} />);
    const open = screen.getByRole('button', { name: 'Mở trên website' });
    expect(parseInt(open.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
    fireEvent.click(open);
    await waitFor(() => expect(openWebPortal).toHaveBeenCalledWith(webPortalUrl(key)));
    expect(openWebPortal).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Chưa mở được website/)).toBeNull();
  });

  it('mở không được: hiện lời hướng dẫn sao chép liên kết, không ném lỗi', async () => {
    openWebPortal.mockResolvedValue(false);
    render(<WebPortalRedirectPage screen="/staff" />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở trên website' }));
    expect(await screen.findByText(/Chưa mở được website ngay trong Zalo/)).toBeInTheDocument();
  });

  it('mở được lần sau thì lời cảnh báo cũ biến mất', async () => {
    openWebPortal.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<WebPortalRedirectPage screen="/staff" />);
    const open = screen.getByRole('button', { name: 'Mở trên website' });
    fireEvent.click(open);
    await screen.findByText(/Chưa mở được website/);
    fireEvent.click(open);
    await waitFor(() => expect(screen.queryByText(/Chưa mở được website/)).toBeNull());
  });

  it('children (việc chỉ làm được trong Mini App) hiện trên lời giải thích và hai nút chuyển web vẫn đủ', () => {
    render(
      <WebPortalRedirectPage screen="/staff">
        <div data-testid="extra" />
      </WebPortalRedirectPage>,
    );
    const extra = screen.getByTestId('extra');
    const explanation = screen.getByText(/thao tác đầy đủ trên website/);
    expect(extra.compareDocumentPosition(explanation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Mở trên website', 'Sao chép liên kết']);
  });

  it('Sao chép liên kết: chép đúng link và báo thành công', async () => {
    render(<WebPortalRedirectPage screen="/admin/community" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép liên kết' }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('https://tubutree.com/admin?tab=community&stay=web'));
    await waitFor(() => expect(openSnackbar).toHaveBeenCalledWith({ text: 'Đã sao chép liên kết', type: 'success' }));
  });

  it('Sao chép liên kết thất bại: báo lỗi, không báo "Đã sao chép"', async () => {
    copyText.mockResolvedValue(false);
    render(<WebPortalRedirectPage screen="/admin" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép liên kết' }));
    await waitFor(() => expect(openSnackbar).toHaveBeenCalledTimes(1));
    const shown = openSnackbar.mock.calls[0]?.[0] as { type: string; text: string };
    expect(shown.type).toBe('error');
    expect(shown.text).not.toMatch(/Đã sao chép/);
  });

  it('query vô hại của link cũ đi theo sang link web (hiện, mở và chép cùng một link), khoá nhạy cảm bị bỏ', async () => {
    routerSearch.value = '?khoi=gian-hang-moi&token=abc&code=1';
    const expected = 'https://tubutree.com/ctv/gian-hang?khoi=gian-hang-moi&stay=web';
    render(<WebPortalRedirectPage screen="/storefront" />);
    expect(screen.getByText(expected)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mở trên website' }));
    await waitFor(() => expect(openWebPortal).toHaveBeenCalledWith(expected));
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép liên kết' }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(expected));
  });

  it('/admin/community giữ tab=community của đích, tab từ link ngoài không ghi đè', () => {
    routerSearch.value = '?tab=orders&khoi=x';
    render(<WebPortalRedirectPage screen="/admin/community" />);
    expect(screen.getByText('https://tubutree.com/admin?tab=community&khoi=x&stay=web')).toBeInTheDocument();
  });
});

// PO A3: web /dai-ly có thanh toán đơn sỉ, nên Mini App không mở nó trong webview Zalo (hồ sơ duyệt Zalo không có lối tới trang trả tiền ngoài).
describe('WebPortalRedirectPage — /dealer chỉ mở bằng trình duyệt', () => {
  it('một h1 Kênh đại lý, câu hướng dẫn mở bằng trình duyệt, hiện link; không có câu "thao tác đầy đủ trên website"', () => {
    render(<WebPortalRedirectPage screen="/dealer" />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Kênh đại lý');
    expect(screen.getByText(DEALER_NOTE)).toBeInTheDocument();
    expect(screen.getByText('https://tubutree.com/dai-ly?stay=web')).toBeInTheDocument();
    expect(screen.queryByText(/thao tác đầy đủ trên website/)).toBeNull();
  });

  it('chỉ một nút: Sao chép liên kết là nút chính (primary, cao ≥ 44px); không có nút Mở trên website', () => {
    render(<WebPortalRedirectPage screen="/dealer" />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Sao chép liên kết']);
    expect(screen.queryByRole('button', { name: 'Mở trên website' })).toBeNull();
    const copy = screen.getByRole('button', { name: 'Sao chép liên kết' });
    expect(copy.className).toContain('zaui-btn-primary');
    expect(parseInt(copy.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
  });

  it('Sao chép liên kết chép đúng link /dai-ly, báo thành công, không bao giờ gọi openWebPortal', async () => {
    render(<WebPortalRedirectPage screen="/dealer" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép liên kết' }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('https://tubutree.com/dai-ly?stay=web'));
    await waitFor(() => expect(openSnackbar).toHaveBeenCalledWith({ text: 'Đã sao chép liên kết', type: 'success' }));
    expect(openWebPortal).not.toHaveBeenCalled();
    expect(screen.queryByText(/Chưa mở được website/)).toBeNull();
  });

  it('link cũ có query vô hại: link hiện và chép giữ query, câu hướng dẫn chỉ nêu tubutree.com/dai-ly', async () => {
    routerSearch.value = '?tab=bang-gia&token=abc';
    render(<WebPortalRedirectPage screen="/dealer" />);
    expect(screen.getByText('https://tubutree.com/dai-ly?tab=bang-gia&stay=web')).toBeInTheDocument();
    expect(screen.getByText(DEALER_NOTE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép liên kết' }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('https://tubutree.com/dai-ly?tab=bang-gia&stay=web'));
    expect(openWebPortal).not.toHaveBeenCalled();
  });
});
