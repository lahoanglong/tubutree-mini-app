import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const app = readFileSync(join(fileURLToPath(new URL('./', import.meta.url)), 'app.tsx'), 'utf-8');

// Guard chặn gửi ảnh khi khách đã rời màn chat mất tác dụng (mở cửa gửi) nếu provider bị gỡ hoặc nằm trong AnimationRoutes,
// vì khi đó useLivePathnameRef() trả null hoặc location đóng băng.
describe('LivePathnameProvider trong app.tsx', () => {
  it('bọc ngoài AnimationRoutes và nằm trong ZMPRouter', () => {
    const at = (needle: string) => {
      const i = app.indexOf(needle);
      expect(i, `thiếu ${needle}`).toBeGreaterThan(-1);
      return i;
    };
    const router = at('<ZMPRouter>');
    const open = at('<LivePathnameProvider>');
    const routesOpen = at('<AnimationRoutes>');
    const routesClose = at('</AnimationRoutes>');
    const close = at('</LivePathnameProvider>');
    const routerClose = at('</ZMPRouter>');
    expect(router).toBeLessThan(open);
    expect(open).toBeLessThan(routesOpen);
    expect(routesClose).toBeLessThan(close);
    expect(close).toBeLessThan(routerClose);
  });
});
