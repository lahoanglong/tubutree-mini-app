// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { HOME_KIND_KEY, useHomeCustomerKind } from './use-home-customer-kind';

type Purchased = Parameters<typeof useHomeCustomerKind>[2];
const pending: Purchased = { isPending: true, isSuccess: false, data: undefined };
const done = (n: number): Purchased => ({ isPending: false, isSuccess: true, data: { items: new Array(n).fill({}), nextCursor: null } as never });

type Step = { authed: boolean; userId?: string; purchased: Purchased; authPending: boolean };

function sequence(steps: Step[]) {
  const { result, rerender } = renderHook((s: Step) => useHomeCustomerKind(s.authed, s.userId, s.purchased, s.authPending), { initialProps: steps[0]! });
  const seen = [result.current];
  for (const s of steps.slice(1)) {
    rerender(s);
    seen.push(result.current);
  }
  return seen;
}

beforeEach(() => localStorage.clear());

describe('useHomeCustomerKind trên Mini: chuỗi trạng thái lúc mở app', () => {
  it('máy chưa nhớ gì: không bao giờ hiện bố cục khách mới trước khi biết (khách cũ đổi máy không thấy quà khách mới)', () => {
    const seen = sequence([
      { authed: false, authPending: true, purchased: pending },
      { authed: true, userId: 'u1', authPending: false, purchased: pending },
      { authed: true, userId: 'u1', authPending: false, purchased: done(3) },
    ]);
    expect(seen).toEqual(['unknown', 'unknown', 'returning']);
  });

  it('máy chưa nhớ gì, khách mới thật: chỉ đổi một lần, từ "unknown" sang "new"', () => {
    const seen = sequence([
      { authed: false, authPending: true, purchased: pending },
      { authed: true, userId: 'u1', authPending: false, purchased: pending },
      { authed: true, userId: 'u1', authPending: false, purchased: done(0) },
    ]);
    expect(seen).toEqual(['unknown', 'unknown', 'new']);
  });

  it('máy đã nhớ khách cũ: giữ "returning" suốt chuỗi', () => {
    localStorage.setItem(HOME_KIND_KEY, JSON.stringify({ userId: 'u1', kind: 'returning' }));
    const seen = sequence([
      { authed: false, authPending: true, purchased: pending },
      { authed: true, userId: 'u1', authPending: false, purchased: pending },
      { authed: true, userId: 'u1', authPending: false, purchased: done(3) },
    ]);
    expect(seen).toEqual(['returning', 'returning', 'returning']);
  });
});
