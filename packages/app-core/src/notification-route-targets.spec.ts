import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMiniAppRoutes, webPathToFileCandidates } from '../../../scripts/check-platform-parity.mjs';
import routeMap from './route-map.json';
import { notificationAction, type NotificationRouteOptions } from './notification-route';

/**
 * Nút đi tiếp của MỌI mẫu tin trong seed (cả những tin đã gửi, nằm sẵn trong hộp thư của khách) phải tới một màn còn tồn tại: đường dẫn Mini App khớp
 * một dòng `route-map.json` (kể cả `:id`) có `<Route>` thật trong app.tsx, và dòng đó có trang web tương ứng (không `skip`, không `pending`, có `page.tsx`).
 * Route đã thành chuyển hướng (`/vouchers`, `/rewards`) vẫn đạt vì dòng và `<Route>` của nó còn giữ.
 */
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p: string) => readFileSync(join(REPO, p), 'utf8');
const webFileExists = (webPath: string) => webPathToFileCandidates(webPath).some((p: string) => existsSync(join(REPO, p)));

function seededCodes(): string[] {
  return [...read('apps/api/prisma/seed.ts').matchAll(/\{\s*id:\s*'nt-[^']*',\s*code:\s*'([A-Z0-9_]+)'/g)].map((m) => m[1]!);
}

interface Row {
  miniapp: string;
  web?: string;
  skip?: string;
  pending?: boolean;
}
const rows: Row[] = (routeMap.routes as { items: Row[] }[]).flatMap((g) => g.items);
const miniRoutes: string[] = parseMiniAppRoutes(read('apps/miniapp/src/components/app.tsx'));

const segments = (path: string) => path.split(/[?#]/, 1)[0]!.split('/').filter(Boolean);
const paramCount = (r: Row) => segments(r.miniapp).filter((s) => s.startsWith(':')).length;

/** Dòng route-map khớp đường dẫn Mini App; đường tĩnh thắng đường có tham số (`/feed/events` trước `/feed/:id`), như bộ định tuyến. */
function matchRow(path: string): Row | null {
  const input = segments(path);
  const hits = rows.filter((r) => {
    const pattern = segments(r.miniapp);
    return pattern.length === input.length && pattern.every((s, i) => s.startsWith(':') || s === input[i]);
  });
  return hits.sort((a, b) => paramCount(a) - paramCount(b))[0] ?? null;
}

/** Lý do một đích Mini App không tới được màn thật trên cả hai nền tảng; null khi ổn. */
function miniTargetProblem(path: string): string | null {
  if (!path.startsWith('/') || path.startsWith('//')) return 'không phải đường dẫn nội bộ';
  const row = matchRow(path);
  if (!row) return 'không khớp dòng nào của route-map.json';
  if (!miniRoutes.includes(row.miniapp)) return `${row.miniapp} không có <Route> trong app.tsx`;
  if (row.skip !== undefined || typeof row.web !== 'string') return `${row.miniapp} không có route web`;
  if (row.pending) return `${row.miniapp} → ${row.web} còn pending`;
  if (!webFileExists(row.web)) return `${row.miniapp} → ${row.web} không có page.tsx/route.ts`;
  return null;
}

const DATA: Record<string, string>[] = [
  {},
  { order_code: 'TT123' },
  { product_slug: 'nuoc-rua-chen' },
  { product_slug: 'nuoc-rua-chen', order_id: 'o1' },
  { request_id: 'r1' },
  { post_id: 'p1' },
];
const OPTIONS: NotificationRouteOptions[] = [{ platform: 'miniapp' }, { platform: 'miniapp', hasSubscription: true }, { platform: 'web' }];

function apiSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) apiSourceFiles(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

describe('đích nút đi tiếp của thông báo', () => {
  it('đọc được mã mẫu tin trong seed và route Mini App trong app.tsx (spec không chạy trên danh sách rỗng)', () => {
    expect(seededCodes().length).toBeGreaterThan(80);
    expect(miniRoutes.length).toBeGreaterThan(50);
  });

  it('mọi mẫu tin trong seed, với mọi kiểu dữ liệu tin thường mang: đích Mini App có màn thật trên Mini App và web', () => {
    const problems: string[] = [];
    let checked = 0;
    for (const code of seededCodes()) {
      for (const data of DATA) {
        for (const opts of OPTIONS) {
          const a = notificationAction(code, data, opts);
          if (!a) continue;
          const where = `${code} ${JSON.stringify(data)} ${opts.platform}`;
          if (a.kind === 'link' || a.kind === 'reorder') {
            checked += 1;
            const problem = miniTargetProblem(a.to);
            if (problem) problems.push(`${where} → ${a.to}: ${problem}`);
          } else if (a.kind === 'review') {
            checked += 1;
            const problem = miniTargetProblem(`/product/${encodeURIComponent(a.productSlug)}`);
            if (problem) problems.push(`${where} → đánh giá ${a.productSlug}: ${problem}`);
          } else {
            checked += 1;
            if (opts.platform !== 'web') problems.push(`${where} → ${a.to}: đường dẫn web đi thẳng chỉ dành cho web`);
            else if (!webFileExists(a.to)) problems.push(`${where} → ${a.to}: web không có page.tsx/route.ts`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
    expect(problems).toEqual([]);
  });

  it('đường dẫn `route` mà API gắn vào dữ liệu tin cũng tới màn thật', () => {
    const routes = new Set<string>();
    for (const file of apiSourceFiles(join(REPO, 'apps/api/src'))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\broute:\s*'(\/[^']*)'/g)) routes.add(m[1]!);
    }
    expect(routes.size).toBeGreaterThan(0);
    const problems = [...routes].map((r) => [r, miniTargetProblem(r)] as const).filter(([, p]) => p !== null);
    expect(problems).toEqual([]);
  });

  it('liên kết cũ tới Mã giảm giá, Kho quà vẫn khớp route còn giữ (chuyển hướng), không rơi về màn không tìm thấy', () => {
    for (const path of ['/vouchers', '/vouchers?tab=history', '/rewards', '/rewards/mine']) expect(miniTargetProblem(path), path).toBeNull();
  });
});
