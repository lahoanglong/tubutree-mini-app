import { useState, type ReactNode } from 'react';
import { Page, useLocation, useSnackbar } from 'zmp-ui';
import { Button } from '../components/ui/button';
import { PageHeader } from '../components/ui/page-header';
import { Text } from '../components/ui/text';
import { openWebPortal } from '../services/zmp-bridge';
import { copyText } from '../utils/clipboard';
import { WEB_PORTAL_SCREENS, webPortalUrl, type WebPortalScreenKey } from './web-portal-screens';

/**
 * Thay cho 8 màn quản trị, đối tác và nhân sự đã rời gói Mini App: giữ nguyên đường dẫn, nói rõ việc làm đầy đủ ở
 * website và đưa khách sang đúng trang. Nút Quay lại là nút nổi của vỏ app (back-button.tsx), PageHeader chừa chỗ
 * cho nó; vẽ thêm một nút ở đây sẽ thành hai nút cùng tên ở cùng chỗ. `children` là việc chỉ làm được trong Mini App
 * (hiện chỉ chấm công của /staff), đặt trên cùng vì đó là việc nhân viên mở màn này để làm.
 */
export default function WebPortalRedirectPage({ screen, children }: { screen: WebPortalScreenKey; children?: ReactNode }) {
  const { openSnackbar } = useSnackbar();
  const { search } = useLocation();
  const [openFailed, setOpenFailed] = useState(false);
  const { title, audience } = WEB_PORTAL_SCREENS[screen];
  const url = webPortalUrl(screen, search);

  const open = async () => {
    const ok = await openWebPortal(url);
    setOpenFailed(!ok);
  };
  const copy = async () => {
    const ok = await copyText(url);
    openSnackbar(ok ? { text: 'Đã sao chép liên kết', type: 'success' } : { text: 'Chưa sao chép được, hãy giữ vào liên kết để chép', type: 'error' });
  };

  return (
    <Page className="page" style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title={title} />
      <div style={{ padding: 'var(--space-inset-page)', display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-md)' }}>
        {children}
        <Text variant="body-md" as="p" style={{ margin: 0 }}>
          {audience} thao tác đầy đủ trên website. Mở trang bên dưới để làm việc với đủ công cụ.
        </Text>
        <div style={{ padding: 'var(--space-inset-card)', borderRadius: 'var(--radius-card)', background: 'var(--color-bg-surface)' }}>
          <Text variant="body-sm" tone="secondary" as="div" numeric style={{ overflowWrap: 'anywhere' }}>{url}</Text>
        </div>
        <Button size="lg" fullWidth onPress={open}>Mở trên website</Button>
        <Button size="lg" fullWidth variant="secondary" onPress={copy}>Sao chép liên kết</Button>
        <div role="status">
          {openFailed && (
            <Text variant="body-sm" tone="warning" as="p" style={{ margin: 0 }}>
              Chưa mở được website ngay trong Zalo. Sao chép liên kết rồi dán vào trình duyệt nhé.
            </Text>
          )}
        </div>
      </div>
    </Page>
  );
}
