import { Page } from 'zmp-ui';
import { AlbumScreen } from '../components/game-album/album-screen';

// Mọi phần Sổ tay Xanh trên Mini (màn sổ, dòng lối vào ở Vườn Xanh, dòng "+N thẻ mới" ở màn kết quả) nằm trong MỘT chunk lười của route này:
// Vườn Xanh và màn kết quả chỉ nạp chunk khi vẽ dòng của sổ, không mang mã của sổ, và gói Mini không tốn thêm chunk dùng chung.
export { AlbumLine } from '../components/game-album/album-screen';

/** Màn Sổ tay Xanh (`/game/album`, cặp web `/vuon-xanh/so-tay`). */
export default function GameAlbumPage() {
  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <AlbumScreen />
    </Page>
  );
}
