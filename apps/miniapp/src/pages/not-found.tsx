import { Page, useNavigate } from 'zmp-ui';
import { EmptyState } from '../components/ui/empty-state';

/** Trang 404 — "trang lạc đường". Hình là SVG của EmptyState: emoji 72px đặt trong Text (line-height ~20px) tràn xuống đè tiêu đề. */
export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>
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
