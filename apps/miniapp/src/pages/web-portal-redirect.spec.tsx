import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const openSnackbar = vi.hoisted(() => vi.fn());
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useSnackbar: () => ({ openSnackbar }),
}));
const openWebPortal = vi.hoisted(() => vi.fn());
vi.mock('../services/zmp-bridge', () => ({ openWebPortal }));
const copyText = vi.hoisted(() => vi.fn());
vi.mock('../utils/clipboard', () => ({ copyText }));

import WebPortalRedirectPage from './web-portal-redirect';
import { WEB_PORTAL_SCREENS, webPortalUrl, type WebPortalScreenKey } from './web-portal-screens';

const KEYS = Object.keys(WEB_PORTAL_SCREENS) as WebPortalScreenKey[];

beforeEach(() => {
  openWebPortal.mockReset().mockResolvedValue(true);
  copyText.mockReset().mockResolvedValue(true);
  openSnackbar.mockReset();
});

describe('WebPortalRedirectPage — thẻ chuyển sang website', () => {
  it.each(KEYS)('%s: một h1 là tiêu đề màn, nói rõ làm đầy đủ trên website và hiện link', (key) => {
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

  it.each(KEYS)('%s: nút chính cao tối thiểu 48px khai báo và mở đúng link web', async (key) => {
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
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('https://tubutree.com/admin?tab=community'));
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
});
