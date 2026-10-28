// @vitest-environment jsdom
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mount } from './mini/harness';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/error-report', () => ({ reportError: vi.fn() }));
vi.mock('@/components/support-hotline', () => ({ SupportHotline: () => null }));

import { SegmentError } from './segment-error';

describe('SegmentError', () => {
  it('Thử lại gọi cả reset và router.refresh (lỗi từ server component cần tải lại dữ liệu phía server)', async () => {
    const reset = vi.fn();
    const { container } = mount(<SegmentError error={new Error('boom')} reset={reset} message="Lỗi" />);
    const btn = container.querySelector('button')!;
    await act(async () => {
      btn.click();
    });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
