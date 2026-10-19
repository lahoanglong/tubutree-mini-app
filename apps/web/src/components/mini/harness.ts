import { afterEach } from 'vitest';
import type { ReactElement } from 'react';
import { render, type Rendered } from '@/test-utils/dom';

/** Dùng chung cho *.spec.tsx của components/mini: mount và tự gỡ sau mỗi test. */
let mounted: Rendered[] = [];
export const mount = (ui: ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});
