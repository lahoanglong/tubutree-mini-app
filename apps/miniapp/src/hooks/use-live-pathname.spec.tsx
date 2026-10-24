import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { LivePathnameProvider, useLivePathnameRef } from './use-live-pathname';

let live: ReturnType<typeof useLivePathnameRef> = null;
function Page() {
  live = useLivePathnameRef();
  const navigate = useNavigate();
  return <button onClick={() => navigate('/other')}>đi</button>;
}
/** Giống zmp-ui AnimationRoutes: trang cũ được giữ lại với location đóng băng khi route đã đổi. */
function FrozenRoutes() {
  const location = useLocation();
  return (
    <Routes location={location}>
      <Route path="/chat" element={<Page />} />
      <Route path="/other" element={<Page />} />
    </Routes>
  );
}

describe('useLivePathnameRef', () => {
  it('theo dõi đường dẫn hiện tại của router, kể cả khi trang đã rời đi vẫn đang mount', () => {
    render(
      <MemoryRouter initialEntries={['/chat']}>
        <LivePathnameProvider>
          <FrozenRoutes />
        </LivePathnameProvider>
      </MemoryRouter>,
    );
    expect(live!.current).toBe('/chat');
    fireEvent.click(screen.getByRole('button', { name: 'đi' }));
    expect(live!.current).toBe('/other');
  });

  it('không có provider: null', () => {
    live = undefined as never;
    render(<MemoryRouter><Page /></MemoryRouter>);
    expect(live).toBeNull();
  });
});
