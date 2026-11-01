// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { render, flush } from '@/test-utils/dom';

vi.mock('./auth-context', () => ({
  useAuth: () => ({ status: 'authenticated', initialized: true, sessionUnavailable: false }),
}));

import { useAuthPhase } from './auth-phase';

function Probe() {
  return <span>{useAuthPhase()}</span>;
}

describe('useAuthPhase', () => {
  it('lượt vẽ đầu (máy chủ, hydrate) luôn là loading dù phiên đã khôi phục, để HTML không lệch', () => {
    expect(renderToString(<Probe />)).toContain('loading');
  });
  it('sau hydrate trả đúng pha thật', async () => {
    const r = render(<Probe />);
    await flush();
    expect(r.container.textContent).toBe('authenticated');
    r.unmount();
  });
});
