import { Page } from 'zmp-ui';
import MatcherFlow from '../components/game/matcher/matcher-flow';

/** Màn Chọn Chuẩn Xanh (`/game/matcher`, cặp web `/vuon-xanh/chon-chuan-xanh`): chunk lười riêng của route, Vườn Xanh không mang mã màn này. */
export default function GameMatcherPage() {
  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <MatcherFlow />
    </Page>
  );
}
