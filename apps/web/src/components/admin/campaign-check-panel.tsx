'use client';

import type { CampaignIssue } from '@/lib/admin-campaigns-client';
import type { BannerImageCheck } from '@/lib/use-banner-image-check';
import type { CampaignCheckState } from '@/lib/use-campaign-check';
import { ToneBadge } from './ui';

/** Cảnh báo ảnh đo ở trình duyệt, xếp cùng danh sách với kết quả của máy chủ. Không bao giờ là lỗi chặn. */
export function imageIssues(image: BannerImageCheck): CampaignIssue[] {
  if (image.status === 'crop')
    return [{ code: 'IMAGE_CROP', level: 'WARN', message: image.message ?? '' }];
  if (image.status === 'error')
    return [{ code: 'IMAGE_LOAD', level: 'WARN', message: image.message ?? '' }];
  return [];
}

/**
 * Khối "Kiểm trước khi bật" của form chiến dịch: lỗi chặn đỏ, cảnh báo vàng, không có gì thì "Sẵn sàng" xanh.
 * Lỗi chặn do máy chủ trả; ảnh lệch khung hay không tải được do trình duyệt đo.
 */
export function CampaignCheckPanel({
  check,
  image,
  onRecheck,
}: {
  check: CampaignCheckState;
  image: BannerImageCheck;
  onRecheck?: () => void;
}) {
  const issues = [...check.issues, ...imageIssues(image)];
  const settled = check.status === 'ready';
  return (
    <section
      aria-label="Kiểm trước khi bật"
      data-testid="campaign-check"
      className="space-y-2 rounded-card border border-stone-200 p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-stone-700">Kiểm trước khi bật</h3>
        {onRecheck && check.status !== 'idle' && (
          <button
            type="button"
            onClick={onRecheck}
            disabled={check.status === 'loading'}
            className="inline-flex min-h-[44px] items-center text-xs font-medium text-forest-700 underline sm:min-h-[36px] disabled:opacity-50"
          >
            Kiểm lại
          </button>
        )}
      </div>
      {check.status === 'idle' && (
        <p className="text-xs text-stone-500">Điền ngày bắt đầu, kết thúc và đích bấm để kiểm.</p>
      )}
      {check.status === 'loading' && issues.length === 0 && (
        <p role="status" className="text-xs text-stone-500">
          Đang kiểm…
        </p>
      )}
      {check.status === 'error' && (
        <p role="status" className="text-xs text-warning-fg">
          Chưa kiểm được ({check.message}). Hệ thống vẫn kiểm lại khi bạn bật chiến dịch.
        </p>
      )}
      {settled && issues.length === 0 && (
        <p
          role="status"
          data-testid="campaign-check-ready"
          className="text-sm font-medium text-success-fg"
        >
          Sẵn sàng
        </p>
      )}
      {issues.length > 0 && (
        <ul className="space-y-1.5">
          {issues.map((i) => (
            <li
              key={`${i.code}-${i.message}`}
              data-level={i.level}
              className="flex flex-wrap items-start gap-2 text-sm"
            >
              <ToneBadge tone={i.level === 'BLOCK' ? 'danger' : 'warning'}>
                {i.level === 'BLOCK' ? 'Chặn bật' : 'Cảnh báo'}
              </ToneBadge>
              <span
                className={`min-w-0 flex-1 basis-48 break-words ${i.level === 'BLOCK' ? 'text-danger-fg' : 'text-stone-800'}`}
              >
                {i.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
