import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { HomeBanner } from './home-banner';
import { HomeCombos } from './home-combos';

describe('Khối banner và combo của Trang chủ (chờ P11 và P15)', () => {
  it('chưa có chiến dịch: HomeBanner không vẽ gì, không giữ chỗ', () => {
    const { container } = render(<HomeBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('chưa có combo: HomeCombos không vẽ gì, không giữ chỗ', () => {
    const { container } = render(<HomeCombos />);
    expect(container).toBeEmptyDOMElement();
  });
});
