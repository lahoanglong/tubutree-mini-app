'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { WasteItemDTO, WasteMethod, WasteRequestSummaryDTO } from '@tubutree/shared-types';
import { wastePointsQuery, wasteRequestQuery } from '@tubutree/app-core/queries/waste';
import { buildRepeatDraft, repeatCardView } from '@tubutree/app-core/refill/repeat-waste';
import { coreHttp } from '@/lib/core-http';
import { friendlyActionError } from '@/lib/friendly-error';
import { markResume, saveDraft } from '@/lib/recycle-wizard';
import { Button } from '@/components/mini';
import { saveRepeatNotes } from './repeat-notes';

export interface RepeatWasteCardProps {
  /** Yêu cầu hoàn tất gần nhất (`lastCompletedRequest`). */
  request: WasteRequestSummaryDTO;
  methodLabel: string;
  items: readonly WasteItemDTO[];
  /** Cách gửi đang mở với khách này (đã lọc theo cấu hình và khoá đường kho). */
  methods: readonly WasteMethod[];
  /** Lối vào cũ (bước chọn loại rác trống). */
  newHref: string;
}

/**
 * "Gửi lại như lần trước" ở trang Đổi rác (cờ `waste.repeat_request_enabled`, bản web của khối cùng tên ở Mini App): một nút dựng nháp từ yêu cầu hoàn tất gần
 * nhất rồi mở bước chọn loại rác; phần không còn hợp lệ bị bỏ và nói ở đúng bước, ô đồng ý thể lệ khách tích lại. "Tạo yêu cầu mới" thành lối phụ.
 */
export function RepeatWasteCard({ request, methodLabel, items, methods, newHref }: RepeatWasteCardProps) {
  const qc = useQueryClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Khoá đồng bộ: hai cú chạm trong cùng một nhịp vẽ không dựng nháp và chuyển trang hai lần.
  const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const view = repeatCardView(request, methodLabel);
  const start = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const [detail, points] = await Promise.all([
        qc.fetchQuery(wasteRequestQuery(coreHttp, request.id)),
        request.method === 'DROP_OFF' ? qc.fetchQuery(wastePointsQuery(coreHttp, null)).catch(() => null) : null,
      ]);
      const d = buildRepeatDraft({ detail, items, enabledMethods: methods, points });
      saveDraft({
        lines: d.lines,
        method: d.method,
        pointId: d.pointId,
        pickedPoint: d.pickedPoint,
        provinceCode: null,
        ...(d.homePickupWeight ? { homePickup: { addressId: null, weightGrams: d.homePickupWeight } } : {}),
      });
      saveRepeatNotes({ items: d.itemsNote, method: d.methodNote });
      markResume();
      router.push(newHref);
    } catch (e) {
      setError(friendlyActionError(e));
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <div data-testid="waste-repeat" className="flex flex-col gap-2">
      <div>
        <p className="text-sm font-semibold text-stone-900">{view.title}</p>
        <p className="text-caption text-stone-600">{view.subtitle}</p>
      </div>
      <Button fullWidth loading={busy} onPress={start}>
        {view.cta}
      </Button>
      <Button variant="ghost" fullWidth onPress={() => router.push(newHref)}>
        {view.newRequest}
      </Button>
      {error && (
        <p role="alert" className="text-caption text-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
}
