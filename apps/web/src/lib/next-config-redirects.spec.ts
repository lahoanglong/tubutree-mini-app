import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config.mjs';
import { miniappRedirects } from './route-map';

describe('next.config redirects()', () => {
  it('đúng danh sách sinh từ route map, đều 307', async () => {
    const list = await nextConfig.redirects!();
    expect(list).toEqual(miniappRedirects());
    expect(list.every((r) => r.permanent === false)).toBe(true);
  });
});
