import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useNavigationType as useRouterNavigationType } from 'react-router-dom';
import { NavigationTypeProvider, useNavigationType } from './use-navigation-type';

/** Ghi lại loại điều hướng thấy được TẠI LÚC MOUNT của mỗi trang (như useScrollRestoration/Browse làm). */
const mountedAs: string[] = [];
function Probe({ name }: { name: string }) {
  const own = useNavigationType();
  const raw = useRouterNavigationType();
  const navigate = useNavigate();
  if (!mountedAs.some((m) => m.startsWith(`${name}:`))) mountedAs.push(`${name}:${own}/${raw}`);
  return (
    <div>
      <button onClick={() => navigate('/b')}>push</button>
      <button onClick={() => navigate('/c', { replace: true })}>replace</button>
      <button onClick={() => navigate(-1)}>back</button>
    </div>
  );
}

/** Giống zmp-ui AnimationRoutes: truyền `location` tường minh cho <Routes>. */
function ExplicitLocationRoutes() {
  const location = useLocation();
  return (
    <Routes location={location}>
      <Route path="/" element={<Probe name="a" />} />
      <Route path="/b" element={<Probe name="b" />} />
      <Route path="/c" element={<Probe name="c" />} />
    </Routes>
  );
}

describe('useNavigationType (đúng loại điều hướng bên trong Routes có location tường minh)', () => {
  it('react-router thô luôn báo POP trong Routes có location; hook của app báo PUSH / REPLACE / POP đúng', () => {
    mountedAs.length = 0;
    render(
      <MemoryRouter initialEntries={['/']}>
        <NavigationTypeProvider>
          <ExplicitLocationRoutes />
        </NavigationTypeProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('push'));
    fireEvent.click(screen.getByText('replace'));
    fireEvent.click(screen.getByText('back'));
    // [tên:hook của app/hook thô]. Trang 'a' mount lúc đầu (POP) rồi mount lại khi Back.
    expect(mountedAs).toEqual(['a:POP/POP', 'b:PUSH/POP', 'c:REPLACE/POP']);
  });

  it('không có provider thì lùi về hook của react-router (MemoryRouter + Routes thường)', () => {
    mountedAs.length = 0;
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Probe name="a" />} />
          <Route path="/b" element={<Probe name="b" />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('push'));
    expect(mountedAs).toEqual(['a:POP/POP', 'b:PUSH/PUSH']);
  });
});
