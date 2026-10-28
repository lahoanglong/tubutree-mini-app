// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';

vi.mock('../lib/auth-context', () => ({ AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import { Providers } from './providers';

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  delete document.body.dataset.hydrated;
});

describe('Providers — dấu hydrate cho e2e', () => {
  it('body chưa có data-hydrated trước khi React gắn xong, có "true" sau khi gắn', () => {
    expect(document.body.dataset.hydrated).toBeUndefined();
    mounted = render(<Providers>nội dung</Providers>);
    expect(document.body.dataset.hydrated).toBe('true');
  });
});
