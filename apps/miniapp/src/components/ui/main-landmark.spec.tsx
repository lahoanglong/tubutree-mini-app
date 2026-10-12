import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MainLandmark } from './main-landmark';

// C-114 (A4-034): axe `landmark-one-main` failed on 41/41 screens because zmp-ui's Page/Box render <div>s.
describe('MainLandmark', () => {
  it('exposes exactly one main landmark that contains the routed content', () => {
    render(
      <MainLandmark>
        <p>Nội dung trang</p>
      </MainLandmark>,
    );
    const main = screen.getByRole('main');
    expect(main.tagName).toBe('MAIN');
    expect(main).toContainElement(screen.getByText('Nội dung trang'));
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('is layout-neutral so zmp-ui page positioning and flex/height chains are unchanged', () => {
    render(<MainLandmark>x</MainLandmark>);
    expect(screen.getByRole('main').style.display).toBe('contents');
  });
});
