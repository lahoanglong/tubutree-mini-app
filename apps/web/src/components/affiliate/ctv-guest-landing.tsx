import Link from 'next/link';
import { BadgePercent, Handshake, Landmark, Store } from 'lucide-react';
import { ui } from '@/lib/guest-ui';

const CTV_GUEST_PILLARS = [
  {
    Icon: Store,
    title: 'Gian hàng & link chia sẻ mang tên bạn',
    body: 'Tạo trang trưng bày sản phẩm yêu thích kèm đường dẫn riêng, tự động ghi nhận lượt bấm và đơn chuyển đổi.',
  },
  {
    Icon: BadgePercent,
    title: 'Hoa hồng theo món & 5 bậc thưởng tháng',
    body: 'Hưởng hoa hồng rõ ràng trên từng sản phẩm cộng thưởng cột mốc doanh số tháng từ Hạt Giống đến Rừng Già.',
  },
  {
    Icon: Landmark,
    title: 'Chuyển thẳng Ví Tubu 1:1 minh bạch',
    body: 'Hoa hồng sau đối soát chuyển nhanh vào Ví Tubu tỷ lệ 1:1 để mua sắm hoặc nhận chi trả định kỳ rõ ràng.',
  },
] as const;

const CTV_GUEST_STEPS = [
  {
    step: '01',
    title: 'Đăng nhập & mở tài khoản CTV 1 chạm',
    body: 'Không phí tham gia, không ràng buộc doanh số tối thiểu và không cần nhập hàng trữ kho.',
  },
  {
    step: '02',
    title: 'Chọn sản phẩm & chia sẻ trải nghiệm thật',
    body: 'Lấy link chia sẻ nhanh hoặc ghim bộ sản phẩm tâm đắc lên Gian hàng CTV cá nhân của bạn.',
  },
  {
    step: '03',
    title: 'Tubu giao đơn — bạn nhận hoa hồng',
    body: 'Tubu đảm nhận đóng gói, vận chuyển và đổi trả; hoa hồng tự động cộng khi đơn hoàn tất.',
  },
] as const;

/**
 * Màn giới thiệu Cộng tác viên cho khách chưa đăng nhập. Không hook, không 'use client': trang `/ctv` dựng nó ở máy chủ nên HTML đầu có nội dung
 * thật. `storeHref`: một gian hàng đã đăng (danh sách công khai, không gồm gian hàng mẫu) để khách xem gian hàng CTV trông thế nào; chưa có thì bỏ nút.
 */
export function CtvGuestLanding({ storeHref = null }: { storeHref?: string | null }) {
  return (
    <div className="space-y-6" data-testid="ctv-guest-landing">
      <section className="rounded-card border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 [box-shadow:var(--elevation-1)]">
        <div className="inline-flex items-center gap-2 rounded-pill bg-[var(--color-bg-subtle)] px-3 py-1 text-xs font-semibold tracking-wider text-[var(--color-text-brand)]">
          <Handshake className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          CỘNG TÁC VIÊN · 0Đ VỐN · KHÔNG ÔM HÀNG
        </div>
        <h2 className="mt-3 font-display text-2xl font-semibold leading-snug text-[var(--color-text-primary)]">
          Lan toả lối sống xanh lành tính — nhận hoa hồng cho mỗi đơn thành công
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--color-text-secondary)]">
          Mở Gian hàng cá nhân miễn phí trên Tubu Tree. Bạn giới thiệu những sản phẩm sinh học gia đình tin dùng, Tubu lo trọn khâu đóng gói, giao nhận và chăm sóc khách hàng.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link href="/dang-nhap?returnTo=%2Fctv" className={ui.btnPrimary}>
            Đăng nhập để đăng ký CTV
          </Link>
          <a href="#quyen-loi-ctv" className={ui.btnSecondary}>
            Xem quyền lợi & hoa hồng
          </a>
          {storeHref && (
            <Link href={storeHref} className={ui.btnSecondary} data-testid="ctv-sample-store">
              Xem một gian hàng đang mở
            </Link>
          )}
        </div>
      </section>

      <section id="quyen-loi-ctv" aria-label="Quyền lợi Cộng tác viên">
        <h2 className={`${ui.sectionTitle} mb-3`}>Quyền lợi Cộng tác viên Tubu Tree</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {CTV_GUEST_PILLARS.map(({ Icon, title, body }) => (
            <div
              key={title}
              className="rounded-card border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 [box-shadow:var(--elevation-1)]"
            >
              <span className="inline-grid h-10 w-10 place-items-center rounded-control bg-[var(--color-bg-subtle)] text-[var(--color-text-brand)]">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-3 font-display text-base font-semibold text-[var(--color-text-primary)]">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-text-secondary)]">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Quy trình bắt đầu CTV">
        <h2 className={`${ui.sectionTitle} mb-3`}>Bắt đầu trong 3 bước đơn giản</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {CTV_GUEST_STEPS.map((s) => (
            <div
              key={s.step}
              className="rounded-card border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 [box-shadow:var(--elevation-1)]"
            >
              <span className="font-display text-xs font-semibold tracking-widest text-[var(--color-text-brand)]">
                BƯỚC {s.step}
              </span>
              <h3 className="mt-1.5 text-sm font-semibold text-[var(--color-text-primary)]">{s.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">{s.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
