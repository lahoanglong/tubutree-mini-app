import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, replace, prefetch: _prefetch, children, ...rest }: Record<string, unknown> & { href: string; children?: React.ReactNode }) => (
    <a href={href} data-replace={replace === true ? 'true' : 'false'} {...(rest as object)}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ status: 'authenticated' }) }));
vi.mock('@/lib/route-map', async (orig) => ({ ...(await orig<object>()), isWebRouteReady: () => true }));
vi.mock('@/lib/use-offers-dot', () => ({ useOffersDot: () => null }));
vi.mock('@/lib/use-engagement-dots', () => ({ useEngagementDots: () => ({ garden: false, profile: false, checkInElsewhere: false }) }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: 0 }) }));

import BottomNav from './bottom-nav';

describe('BottomNav web: tab gốc sang tab gốc không chồng lịch sử', () => {
  it('cả 5 tab là Link có replace (như Mini App đổi tab bằng replace)', () => {
    const out = renderToStaticMarkup(<BottomNav />);
    const links = out.match(/<a [^>]*>/g) ?? [];
    expect(links).toHaveLength(5);
    for (const a of links) expect(a, a).toContain('data-replace="true"');
  });
});
