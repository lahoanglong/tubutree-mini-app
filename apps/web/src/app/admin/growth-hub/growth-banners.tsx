'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listAdminCampaigns, updateAdminCampaign, type AdminCampaignRow, type AdminCampaignStatus } from '@/lib/admin-campaigns-client';
import { formatVnRange } from '@/lib/admin-campaign-form';
import { actionErrorText } from '@/lib/admin-error-text';
import type { Tone } from '@/lib/recycling';
import { useConfirm } from '@/components/admin/confirm-dialog';
import { BTN_LINK, BTN_XS_SECONDARY, ListSkeleton, LoadError, Notice, ToneBadge } from '@/components/admin/ui';

const STATUS: Record<AdminCampaignStatus, { label: string; tone: Tone; order: number }> = {
  live: { label: 'Đang chạy', tone: 'success', order: 0 },
  scheduled: { label: 'Sắp chạy', tone: 'info', order: 1 },
  off: { label: 'Đang tắt', tone: 'warning', order: 2 },
  ended: { label: 'Đã kết thúc', tone: 'neutral', order: 3 },
};
const PLACEMENT: Record<AdminCampaignRow['placement'], string> = { HOME_TOP: 'Đầu Trang chủ', OFFERS_TOP: 'Đầu Ưu đãi' };
const SHOWN = 6;

/** Banner còn liên quan (đang chạy, sắp chạy, đang tắt), đang chạy trước; chiến dịch đã kết thúc chỉ ở tab Chiến dịch. */
export function bannersToShow(rows: AdminCampaignRow[]): AdminCampaignRow[] {
  return rows
    .filter((r) => r.status !== 'ended')
    .sort((a, b) => STATUS[a.status].order - STATUS[b.status].order || a.startAt.localeCompare(b.startAt));
}

function BannerRow({ row, confirm }: { row: AdminCampaignRow; confirm: ReturnType<typeof useConfirm>['confirm'] }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const toggle = useMutation({
    mutationFn: () => updateAdminCampaign(row.id, { isActive: !row.isActive }),
    onSuccess: () => setError(null),
    onError: (e) => setError(actionErrorText(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin-campaigns'] }),
  });
  const blockers = row.health?.blockers ?? 0;
  const turnOnBlocked = !row.isActive && blockers > 0;
  const ask = async () => {
    const ok = await confirm({
      title: row.isActive ? `Tắt banner "${row.title}"?` : `Bật banner "${row.title}"?`,
      message: row.isActive
        ? 'Banner và trang chiến dịch ẩn với khách ngay. Sản phẩm và mã giảm giá gắn kèm được giữ nguyên.'
        : `Banner hiện ở ${PLACEMENT[row.placement]} trong khung ${formatVnRange(row.startAt, row.endAt)}.`,
      confirmLabel: row.isActive ? 'Tắt banner' : 'Bật banner',
      tone: row.isActive ? 'danger' : 'default',
    });
    if (ok) toggle.mutate();
  };
  const st = STATUS[row.status];
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-stone-900">
            <span className="break-words">{row.title}</span>
            <ToneBadge tone={st.tone}>{st.label}</ToneBadge>
            {blockers > 0 && <ToneBadge tone="danger">{blockers} lỗi chặn</ToneBadge>}
          </div>
          <p className="text-xs text-stone-600">
            {PLACEMENT[row.placement]} · {formatVnRange(row.startAt, row.endAt)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void ask()}
          disabled={toggle.isPending || turnOnBlocked}
          title={turnOnBlocked ? 'Còn lỗi chặn: mở tab Chiến dịch để sửa trước khi bật.' : undefined}
          className={BTN_XS_SECONDARY}
        >
          {toggle.isPending ? 'Đang lưu…' : row.isActive ? 'Tắt' : 'Bật'}
        </button>
      </div>
      {error && <div className="mt-1.5"><Notice tone="danger" role="alert">{error}</Notice></div>}
    </li>
  );
}

export function GrowthBanners({ onOpenCampaigns }: { onOpenCampaigns?: () => void }) {
  const { confirm, dialog } = useConfirm();
  const q = useQuery({ queryKey: ['admin-campaigns', 'all'], queryFn: () => listAdminCampaigns() });
  const shown = bannersToShow(q.data ?? []);
  return (
    <section aria-labelledby="growth-banners-title" className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
      <h2 id="growth-banners-title" className="font-display text-base font-semibold text-stone-900">Banner khuyến mãi</h2>
      <p className="mt-0.5 text-xs text-stone-600">Bật hoặc tắt nhanh banner đầu Trang chủ và đầu Ưu đãi. Tạo, sửa ảnh, gắn sản phẩm và mã ở tab Chiến dịch.</p>
      <div className="mt-2">
        {q.isLoading ? (
          <ListSkeleton label="Đang tải banner" rows={2} className="h-12" />
        ) : q.isError ? (
          <LoadError message="Không tải được danh sách banner." onRetry={() => q.refetch()} retrying={q.isFetching} />
        ) : shown.length === 0 ? (
          <p className="text-sm text-stone-600">Chưa có banner nào đang chạy, sắp chạy hay đang tắt.</p>
        ) : (
          <ul className="divide-y divide-stone-200">
            {shown.slice(0, SHOWN).map((row) => (
              <BannerRow key={row.id} row={row} confirm={confirm} />
            ))}
          </ul>
        )}
        {shown.length > SHOWN && <p className="mt-1 text-xs text-stone-600">Còn {shown.length - SHOWN} banner khác ở tab Chiến dịch.</p>}
      </div>
      {onOpenCampaigns && (
        <button type="button" onClick={onOpenCampaigns} className={`${BTN_LINK} mt-2 text-sm`}>
          Quản lý banner và chiến dịch
        </button>
      )}
      {dialog}
    </section>
  );
}
