// @vitest-environment jsdom
import { act } from 'react';
import type { ReactElement } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, flush, render, type Rendered } from '@/test-utils/dom';
import { makeRewardCatalog } from '@/components/loyalty/reward-fixtures';
import { EMPTY_DRAFT, savePointsNav } from '@/lib/recycle-wizard';
import { makeDeskPoint, makeRequestDetail, makeRequestSummary, makeWastePoint, makeWasteMe } from './recycle-fixtures';

// Mọi "Thử lại" của chuỗi Đổi rác phải trả Promise của lần tải lại: `ErrorState` khoá nút bằng `usePressLock` chỉ khi onRetry trả Promise,
// còn `() => void q.refetch()` trả undefined nên nút không bao giờ báo bận và hai cú chạm sát nhau tải hai lần.
// Thẻ lỗi chỉ còn nút khi truy vấn đã có dữ liệu (chưa có thì refetch đưa status về pending và thẻ biến thành khung chờ), nên mỗi ca
// tải thành công trước rồi mới làm lần tải lại hỏng. Chép ý W77A của Mini App.

const net = vi.hoisted(() => ({
  calls: [] as string[],
  behave: (_path: string): unknown => {
    throw new Error('mất mạng');
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/doi-rac',
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/use-public-config', () => ({
  usePublicConfig: () => ({ isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } }),
}));
vi.mock('@/components/ui/qr-code', () => ({ QrCode: () => null }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      net.calls.push(path);
      return net.behave(path);
    },
    post: async () => {
      throw new Error('trang này không ghi dữ liệu');
    },
  },
}));

import { RecycleDesk } from './recycle-desk';
import { RecycleDone } from './recycle-done';
import { RecycleEdit } from './recycle-edit';
import { RecycleHome } from './recycle-home';
import { RecycleNew } from './recycle-new';
import { RecyclePoints } from './recycle-points';
import { RecycleRequestDetail } from './recycle-request';
import { RecycleRequests } from './recycle-requests';
import { RecycleRulesView } from './recycle-rules-view';

function deferred() {
  let reject!: (e: unknown) => void;
  const promise = new Promise<unknown>((_res, rej) => {
    reject = rej;
  });
  return { promise, reject };
}

const HOTLINE = { support: { hotline: '0984606774', email: 'tubutree@gmail.com', zaloOaName: null } };
const REQUEST = '/waste/requests/req-1';
const count = (path: string) => net.calls.filter((p) => p === path).length;

interface Scenario {
  name: string;
  element: () => ReactElement;
  /** Đường dẫn mà nút Thử lại tải lại; nút chỉ hết bận khi lần tải cuối trong danh sách này xong. */
  retried: string[];
  /** Dữ liệu thật của lần tải đầu; đường nào không có thì lỗi. */
  first: Record<string, unknown>;
  seed?: () => void;
  /** Lỗi ngay từ lần tải đầu (chưa có dữ liệu): thẻ lỗi biến mất lúc tải lại nên chỉ kiểm được số lần `Query.fetch`. */
  noData?: boolean;
  /** Nhả các lần tải theo thứ tự ngược: nút phải chờ cả lần tải đứng đầu danh sách, không chỉ lần cuối. */
  reverse?: boolean;
}

const ME = makeWasteMe();
const SCENARIOS: Scenario[] = [
  {
    name: 'trang chủ Đổi rác: lỗi /waste/me',
    element: () => <RecycleHome />,
    retried: ['/waste/me'],
    first: { '/waste/me': ME, '/me/loyalty/rewards': makeRewardCatalog() },
  },
  { name: 'tạo yêu cầu bước 1: lỗi /waste/me', element: () => <RecycleNew />, retried: ['/waste/me'], first: { '/waste/me': ME } },
  { name: 'thể lệ: lỗi /waste/rules', element: () => <RecycleRulesView />, retried: ['/waste/rules'], first: { '/waste/rules': { text: 'Thể lệ' } } },
  {
    name: 'chi tiết yêu cầu: lỗi tải yêu cầu',
    element: () => <RecycleRequestDetail id="req-1" />,
    retried: [REQUEST],
    first: { [REQUEST]: makeRequestDetail(), '/waste/me': ME, '/waste/points': [], '/config/public': HOTLINE },
  },
  {
    name: 'quầy nhận: lỗi danh sách điểm',
    element: () => <RecycleDesk />,
    retried: ['/waste/desk/points'],
    first: { '/waste/desk/points': [makeDeskPoint()], '/config/public': HOTLINE },
  },
  {
    name: 'chọn điểm nhận: lỗi cả /waste/me lẫn /waste/points (nút chờ đủ hai lần tải)',
    element: () => <RecyclePoints />,
    retried: ['/waste/me', '/waste/points'],
    first: { '/waste/me': ME, '/waste/points': [makeWastePoint()] },
    seed: () => savePointsNav({ returnTo: '/doi-rac/tao?step=method', draft: EMPTY_DRAFT, selectedItemIds: ['item-carton'] }),
  },
  {
    name: 'chọn điểm nhận: hai lần tải xong theo thứ tự ngược',
    element: () => <RecyclePoints />,
    retried: ['/waste/me', '/waste/points'],
    first: { '/waste/me': ME, '/waste/points': [makeWastePoint()] },
    seed: () => savePointsNav({ returnTo: '/doi-rac/tao?step=method', draft: EMPTY_DRAFT, selectedItemIds: ['item-carton'] }),
    reverse: true,
  },
  {
    name: 'yêu cầu của tôi: lỗi danh sách',
    element: () => <RecycleRequests />,
    retried: ['/waste/requests'],
    first: { '/waste/me': ME, '/waste/requests': [makeRequestSummary()] },
  },
  {
    name: 'kết quả: lỗi tải yêu cầu',
    element: () => <RecycleDone id="req-1" />,
    retried: [REQUEST],
    first: { [REQUEST]: makeRequestDetail({ status: 'COMPLETED', editable: false, cancellable: false, pointsAwarded: 4000 }), '/config/public': HOTLINE },
  },
  {
    name: 'sửa yêu cầu: lỗi tải yêu cầu',
    element: () => <RecycleEdit id="req-1" />,
    retried: [REQUEST],
    first: { [REQUEST]: makeRequestDetail(), '/waste/me': ME, '/config/public': HOTLINE },
  },
  {
    name: 'sửa yêu cầu: yêu cầu về được, lỗi /waste/me ngay lần đầu',
    element: () => <RecycleEdit id="req-1" />,
    retried: ['/waste/me'],
    first: { [REQUEST]: makeRequestDetail(), '/config/public': HOTLINE },
    noData: true,
  },
];

let mounted: Rendered[] = [];
const retryButton = () => byText(document.body, 'button', 'Thử lại') as HTMLButtonElement | null;
const reactProps = (el: Element) => {
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'))!;
  return (el as unknown as Record<string, { onClick: () => void }>)[key]!;
};

beforeEach(() => {
  window.sessionStorage.clear();
  net.calls = [];
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

describe('Đổi rác: "Thử lại" trả Promise của lần tải lại để nút khoá đồng bộ', () => {
  it.each(SCENARIOS)('$name', async (s) => {
    s.seed?.();
    const gates = new Map<string, ReturnType<typeof deferred>>();
    let phase: 'first' | 'broken' = 'first';
    net.behave = (path) => {
      const gate = gates.get(path);
      if (gate) return gate.promise;
      if (phase === 'first' && path in s.first) return s.first[path];
      throw new Error('mất mạng');
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const r = render(s.element(), qc);
    mounted.push(r);
    await flush(10);
    phase = 'broken';
    if (!s.noData) {
      await act(async () => {
        await qc.refetchQueries();
      });
      await flush(4);
    }
    const button = retryButton()!;
    expect(button).not.toBeNull();
    expect(button.hasAttribute('aria-busy')).toBe(false);
    const before = s.retried.map(count);
    const fetches = qc.getQueryCache().getAll().map((q) => vi.spyOn(q, 'fetch'));
    const fetched = () => fetches.reduce((n, spy) => n + spy.mock.calls.length, 0);

    for (const p of s.retried) gates.set(p, deferred());
    const props = reactProps(button);
    await act(async () => {
      props.onClick();
      props.onClick();
    });
    await flush(2);
    s.retried.forEach((p, i) => expect(count(p)).toBe(before[i]! + 1));
    expect(fetched()).toBe(s.retried.length);
    if (!s.noData) {
      expect(button.getAttribute('aria-busy')).toBe('true');
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.disabled).toBe(false);
      await act(async () => reactProps(button).onClick());
      s.retried.forEach((p, i) => expect(count(p)).toBe(before[i]! + 1));

      const order = s.reverse ? [...s.retried].reverse() : s.retried;
      const last = order[order.length - 1]!;
      for (const p of order) {
        expect(button.getAttribute('aria-busy')).toBe('true');
        await act(async () => gates.get(p)!.reject(new Error('lại hỏng')));
        await flush(3);
        if (p !== last) expect(button.getAttribute('aria-busy')).toBe('true');
      }
      expect(button.hasAttribute('aria-busy')).toBe(false);
      expect(button.hasAttribute('aria-disabled')).toBe(false);
    } else {
      for (const p of s.retried) await act(async () => gates.get(p)!.reject(new Error('lại hỏng')));
      await flush(3);
    }

    gates.clear();
    await act(async () => reactProps(retryButton()!).onClick());
    await flush(2);
    s.retried.forEach((p, i) => expect(count(p)).toBe(before[i]! + 2));
  });
});
