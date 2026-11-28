import { PrebuiltGuest } from '@/lib/auth-phase';
import { readPublicConfigOnServer } from '@/lib/guest-checkout/server-config';
import { DealerGuestLanding, dealerLandingNumbers } from '@/components/dealer/dealer-guest-landing';
import { ZaloWebViewGate } from '@/components/dealer/zalo-webview-gate';
import DealerPage from './dealer-page';

/** Chiết khấu tối đa và giờ duyệt ít khi đổi: bản dựng sẵn làm mới sau 5 phút như các trang công khai khác. */
export const revalidate = 300;

/**
 * `/dai-ly` dựng ở máy chủ màn giới thiệu Kênh đại lý với số thật của cấu hình công khai, nên khách vãng lai (và công cụ tìm kiếm) có nội dung
 * ngay trong HTML đầu thay vì khung chờ đăng nhập. `PrebuiltGuest` cho lượt vẽ đầu là khách; sau hydrate khách đã đăng nhập chuyển sang hub,
 * hồ sơ chờ duyệt hay form đăng ký như trước (dealer-page.tsx). `ZaloWebViewGate` thay cả trang bằng màn "Mở trên trình duyệt ngoài" khi khách
 * đang trong WebView của Zalo (w33-01).
 */
export default async function DealerRoute() {
  const numbers = dealerLandingNumbers(await readPublicConfigOnServer(revalidate));
  return (
    <ZaloWebViewGate>
      <PrebuiltGuest>
        <DealerPage guestLanding={<DealerGuestLanding {...numbers} />} />
      </PrebuiltGuest>
    </ZaloWebViewGate>
  );
}
