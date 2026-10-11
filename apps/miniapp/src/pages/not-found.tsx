import { Page, useNavigate } from 'zmp-ui';
import { EmptyState } from '../components/ui/empty-state';
import { SR_ONLY } from '../components/ui/sr-only';

/** Trang 404 — "trang lạc đường". Hình là SVG của EmptyState: emoji 72px đặt trong Text (line-height ~20px) tràn xuống đè tiêu đề. */
export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Page className="page" style={{ background: 'var(--color-bg-canvas)' }}>
      {/* EmptyState vẽ tiêu đề bằng Text (không phải heading); h1 ẩn giữ cho trang có đúng một h1 mà không đổi bố cục. */}
      <h1 style={SR_ONLY}>Không tìm thấy trang</h1>
      <div style={{ minHeight: '80vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <EmptyState
          art="search"
          heading="Trang này lạc vào vườn rồi"
          body="Có thể liên kết đã cũ hoặc trang không tồn tại. Quay về trang chủ để tiếp tục dạo vườn nhé."
          ctaLabel="Về trang chủ"
          onCta={() => navigate('/', { replace: true })}
        />
      </div>
    </Page>
  );
}
