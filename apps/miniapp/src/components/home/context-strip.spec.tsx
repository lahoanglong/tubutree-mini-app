import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { HomeContextVariant } from '@tubutree/app-core/home-layout';

const gift = vi.hoisted(() => ({ fallback: undefined as unknown }));
vi.mock('./member-card', () => ({
  MemberCard: () => <section aria-label="Thẻ thành viên" />,
  MemberCardSkeleton: () => <div data-testid="member-card-loading" />,
  MemberCardUnavailable: ({ onRetry }: { onRetry: () => void }) => (
    <button type="button" data-testid="member-card-unavailable" onClick={onRetry}>
      Thử lại
    </button>
  ),
}));
vi.mock('./todo-strip', () => ({ TodoStrip: ({ data }: { data: unknown }) => <section aria-label="Việc cần làm" data-has-data={String(Boolean(data))} /> }));
vi.mock('./new-customer-gift', () => ({
  NewCustomerGift: ({ fallback }: { fallback?: unknown }) => {
    gift.fallback = fallback;
    return <section aria-label="Quà khách mới">{fallback as never}</section>;
  },
}));

import type { HomeTodo } from '../../services/shop-api';
import { HomeContextStrip } from './context-strip';

const TODO = { pending: null, shipping: { order: { code: 'T1' }, total: 1 }, processing: null } as unknown as HomeTodo;
const base = { restoring: false, sessionFailed: false, todo: undefined as HomeTodo | undefined, onRetrySession: () => {} };
const strip = (variant: HomeContextVariant, over: Partial<Parameters<typeof HomeContextStrip>[0]> = {}) => render(<HomeContextStrip {...base} variant={variant} {...over} />);

describe('HomeContextStrip — MỘT dải ngữ cảnh', () => {
  it('skeleton: chỉ khung chờ của thẻ thành viên (cùng chiều cao với mọi biến thể)', () => {
    strip('skeleton');
    expect(screen.getByTestId('member-card-loading')).toBeInTheDocument();
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('todo: Việc cần làm với dữ liệu đơn', () => {
    strip('todo', { todo: TODO });
    expect(screen.getByRole('region', { name: 'Việc cần làm' })).toHaveAttribute('data-has-data', 'true');
  });

  it('gift: Quà khách mới, và truyền thẻ thành viên làm fallback để khách không còn ưu đãi không thấy dải trống', () => {
    strip('gift');
    const region = screen.getByRole('region', { name: 'Quà khách mới' });
    expect(region).toBeInTheDocument();
    expect(gift.fallback).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Thẻ thành viên' })).toBeInTheDocument();
  });

  it('member: thẻ thành viên gọn', () => {
    strip('member');
    expect(screen.getByRole('region', { name: 'Thẻ thành viên' })).toBeInTheDocument();
  });

  it('member khi đang khôi phục phiên: khung chờ (khách cũ chưa biết là ai)', () => {
    strip('member', { restoring: true });
    expect(screen.getByTestId('member-card-loading')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Thẻ thành viên' })).toBeNull();
  });

  it('member khi khôi phục phiên thất bại: thẻ báo lỗi có "Thử lại" gọi onRetrySession, không rơi về bố cục khách mới', () => {
    const onRetrySession = vi.fn();
    strip('member', { sessionFailed: true, onRetrySession });
    screen.getByTestId('member-card-unavailable').click();
    expect(onRetrySession).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('region', { name: 'Quà khách mới' })).toBeNull();
  });
});
