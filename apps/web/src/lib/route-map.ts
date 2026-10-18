import routeMapJson from '@tubutree/app-core/route-map.json';
import { buildMiniappRedirects, type MiniappRedirect } from './miniapp-redirects.mjs';

interface RouteItem {
  miniapp: string;
  web?: string;
  private?: boolean;
  pending?: boolean;
  skip?: string;
}
interface RouteGroup {
  lane: string;
  items: RouteItem[];
}

const groups = routeMapJson.routes as RouteGroup[];
const items: RouteItem[] = groups.flatMap((g) => g.items);
const webItems = items.filter((i): i is RouteItem & { web: string } => typeof i.web === 'string');

function splitWeb(web: string): { segments: string[]; query: URLSearchParams } {
  const [path = '', query = ''] = web.split(/[?#]/, 2);
  return { segments: path.split('/').filter(Boolean), query: new URLSearchParams(query) };
}

interface Match {
  item: RouteItem & { web: string };
  params: Record<string, string>;
  hasQuery: boolean;
  paramCount: number;
}

function matchWeb(webPath: string): Match | null {
  const input = splitWeb(webPath);
  const found: Match[] = [];
  for (const item of webItems) {
    const pattern = splitWeb(item.web);
    if (pattern.segments.length !== input.segments.length) continue;
    const params: Record<string, string> = {};
    const ok = pattern.segments.every((seg, i) => {
      const actual = input.segments[i]!;
      if (seg.startsWith(':')) {
        params[seg.slice(1)] = actual;
        return true;
      }
      return seg === actual;
    });
    if (!ok) continue;
    const queryOk = [...pattern.query].every(([k, v]) => input.query.get(k) === v);
    if (!queryOk) continue;
    found.push({ item, params, hasQuery: [...pattern.query].length > 0, paramCount: Object.keys(params).length });
  }
  // Dòng khớp cả query đích thắng dòng không query; đường tĩnh thắng đường có tham số.
  found.sort((a, b) => Number(b.hasQuery) - Number(a.hasQuery) || a.paramCount - b.paramCount);
  return found[0] ?? null;
}

/** Route web đã làm xong (có trong bản đồ và không còn `pending`); điều hướng chỉ hiện link khi true. */
export function isWebRouteReady(webPath: string): boolean {
  const m = matchWeb(webPath);
  return m !== null && !m.item.pending;
}

/** Đường dẫn Mini App tương ứng của một đường dẫn web (tra ngược, thay tham số), null khi không có. */
export function miniappPathFor(webPath: string): string | null {
  const m = matchWeb(webPath);
  if (!m) return null;
  return m.item.miniapp.replace(/:(\w+)/g, (whole, name: string) => m.params[name] ?? whole);
}

const withoutQuery = (web: string) => web.split(/[?#]/, 1)[0]!;
const underPrefix = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** Tiền tố riêng tư: đường dẫn của route `private` cắt từ tham số đầu, khử trùng và bỏ tiền tố nằm dưới tiền tố khác. */
export function privatePrefixes(): string[] {
  const cut = new Set<string>();
  for (const item of webItems) {
    if (!item.private) continue;
    const segments = withoutQuery(item.web).split('/').filter(Boolean);
    const stop = segments.findIndex((s) => s.startsWith(':'));
    const kept = stop === -1 ? segments : segments.slice(0, stop);
    if (kept.length > 0) cut.add(`/${kept.join('/')}`);
  }
  const all = [...cut];
  return all.filter((p) => !all.some((q) => q !== p && underPrefix(p, q)));
}

/** Route công khai không tham số, không query, đã xong: đưa vào sitemap. */
export function publicStaticRoutes(): string[] {
  const out = new Set<string>();
  for (const item of webItems) {
    if (item.private || item.pending) continue;
    if (item.web.includes(':') || item.web.includes('?')) continue;
    out.add(item.web);
  }
  return [...out];
}

/** Route công khai tĩnh nằm dưới (hoặc trùng) một tiền tố riêng tư: robots phải `allow` riêng, kể cả khi còn pending. */
export function publicAllowPaths(prefixes: readonly string[]): string[] {
  const out = new Set<string>();
  for (const item of webItems) {
    if (item.private || item.web.includes(':') || item.web.includes('?')) continue;
    if (prefixes.some((p) => underPrefix(item.web, p))) out.add(item.web);
  }
  return [...out];
}

/** Chuyển hướng đường dẫn Mini App sang route web cho `next.config.mjs`. */
export function miniappRedirects(): MiniappRedirect[] {
  return buildMiniappRedirects(groups);
}
