'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WasteLineInput } from '@tubutree/shared-types';
import { WASTE_QUERY_KEYS, WASTE_WRITE_INVALIDATE_KEYS, editWasteRequest, previewWaste } from '@tubutree/app-core/api/waste';
import { wasteMeQuery, wasteRequestQuery } from '@tubutree/app-core/queries/waste';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { formatDate } from '@/lib/format-date';
import { ui } from '@/lib/guest-ui';
import { savePointsNav, takeReturn, toLineInputs, type WasteWizardDraft } from '@/lib/recycle-wizard';
import { useDebounced } from '@/lib/use-debounced';
import { usePublicConfig } from '@/lib/use-public-config';
import { formatCount } from '@/lib/checkout-points';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { StickyActionBar } from '@/components/sticky-action-bar';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { WasteItemStep } from './waste-item-step';
import { PREVIEW_DEBOUNCE_MS, formatPoints, pointAddress } from './recycle-labels';

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');

function Shell({ id, subtitle, children, bar }: { id: string; subtitle?: string; children: ReactNode; bar?: ReactNode }) {
  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-6 pb-12">
      <PageHeader title="Sửa yêu cầu" subtitle={subtitle} backHref={`/doi-rac/yeu-cau/${id}`} backLabel="Yêu cầu đổi rác" />
      {children}
      {bar}
    </main>
  );
}

/** Thanh lưu: dính đáy trên điện thoại, nằm cuối trang từ md; hai bản cùng nội dung nên bản máy tính gắn data-desktop-action. */
function Actions({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  const body = (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">{summary}</div>
      <div className="flex-none">{children}</div>
    </div>
  );
  return (
    <>
      <div data-desktop-action className="hidden md:block">
        {body}
      </div>
      <StickyActionBar label="Lưu thay đổi yêu cầu">{body}</StickyActionBar>
    </>
  );
}

export function RecycleEdit({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const phase = useAuthPhase();
  const cfg = usePublicConfig();
  const path = `/doi-rac/yeu-cau/${id}`;
  const editPath = `${path}/sua`;

  const authed = phase === 'authenticated';
  const q = useQuery({ ...wasteRequestQuery(coreHttp, id), enabled: authed });
  const meQ = useQuery({ ...wasteMeQuery(coreHttp), enabled: authed });
  const r = q.data;
  const me = meQ.data;

  // Nháp từ trang chọn điểm đọc ở client sau khi gắn vào cây; setState dạng hàm giữ giá trị đã đọc khi effect chạy lần hai (StrictMode),
  // vì takeReturn xoá khoá ngay lần đầu.
  const [returned, setReturned] = useState<WasteWizardDraft | null>(null);
  const [returnRead, setReturnRead] = useState(false);
  useEffect(() => {
    const back = takeReturn();
    setReturned((prev) => prev ?? back);
    setReturnRead(true);
  }, []);

  const base = useMemo<WasteWizardDraft | null>(() => {
    if (!r) return null;
    return (
      returned ?? {
        lines: Object.fromEntries(r.lines.map((l) => [l.itemId, l.declaredQty])),
        method: r.method,
        pointId: r.point?.id ?? null,
        pickedPoint: null,
        provinceCode: null,
      }
    );
  }, [r, returned]);
  const [edited, setEdited] = useState<WasteWizardDraft | null>(null);
  const draft = edited ?? base;
  const lines = draft?.lines ?? {};
  const lineInputs = toLineInputs(lines);
  const method = r?.method ?? 'DROP_OFF';
  const isDropOff = method === 'DROP_OFF';
  const pointId = draft?.pointId ?? null;

  const ready = returnRead && r !== undefined && (me !== undefined || meQ.isError);
  const canEdit =
    r !== undefined &&
    r.editable &&
    cfg.waste.enabled &&
    me?.programmeEnabled !== false &&
    !me?.blocked &&
    !(r.method !== 'DROP_OFF' && me?.shipLockedAt);
  const leave = ready && !canEdit;
  useEffect(() => {
    if (leave) router.replace(path);
  }, [leave, router, path]);

  const linesKey = useDebounced(JSON.stringify(lineInputs), PREVIEW_DEBOUNCE_MS);
  const debounced = useMemo(() => JSON.parse(linesKey) as WasteLineInput[], [linesKey]);
  const previewQ = useQuery({
    queryKey: [...WASTE_QUERY_KEYS.all, 'preview', 'edit', id, method, pointId, debounced],
    queryFn: () => previewWaste(coreHttp, { lines: debounced, method, ...(isDropOff ? { pointId: pointId ?? undefined } : {}) }),
    enabled: authed && ready && !leave && debounced.length > 0,
  });

  const save = useMutation({
    mutationFn: () => editWasteRequest(coreHttp, id, { lines: lineInputs, ...(isDropOff && pointId ? { pointId } : {}) }),
    onSuccess: async () => {
      await Promise.all(WASTE_WRITE_INVALIDATE_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey })));
      router.replace(path);
    },
  });

  if (phase === 'loading') return <Shell id={id}><AuthLoading /></Shell>;
  if (phase === 'unavailable') return <Shell id={id}><SessionUnavailable /></Shell>;
  if (phase === 'guest') return <Shell id={id}><LoginRequired message="Đăng nhập để sửa yêu cầu đổi rác của bạn." returnTo={editPath} /></Shell>;
  if (q.isError) return <Shell id={id}><ErrorState message={errText(q.error)} onRetry={() => void q.refetch()} /></Shell>;
  if (meQ.isError && !me) return <Shell id={id}><ErrorState message={errText(meQ.error)} onRetry={() => void meQ.refetch()} /></Shell>;
  if (!r || !draft || !ready || leave || !me) return <Shell id={id} subtitle={r?.code}><Skeleton height={120} rounded="rounded-card" /></Shell>;

  const setLine = (itemId: string, n: number) =>
    setEdited((d) => {
      const cur = d ?? draft;
      return { ...cur, lines: { ...cur.lines, [itemId]: n } };
    });
  const activeIds = new Set(me.items.filter((i) => i.status === 'ACTIVE').map((i) => i.id));
  const gone = r.lines.filter((l) => !activeIds.has(l.itemId) && (lines[l.itemId] ?? 0) > 0);
  const shownPoint = draft.pickedPoint ?? r.point;
  const p = debounced.length > 0 ? previewQ.data : undefined;

  const changePoint = () => {
    savePointsNav({ returnTo: editPath, draft: { ...draft, method: r.method }, selectedItemIds: lineInputs.map((l) => l.itemId) });
    router.replace('/doi-rac/diem-nhan');
  };

  const summary = (
    <div>
      {p && <p className="text-sm font-semibold text-stone-900">{`Ước tính mới ${formatPoints(p.estimatedPoints)}`}</p>}
      <p className="text-xs text-stone-600">Điểm ước tính có thể thay đổi theo mức quy đổi hiện hành</p>
      <p className="text-xs text-stone-600">{`Hạn giữ chỗ không đổi: ${formatDate(r.expiresAt)}`}</p>
    </div>
  );

  return (
    <Shell
      id={id}
      subtitle={r.code}
      bar={
        <>
          {save.isError && (
            <p role="alert" className={ui.error}>
              {errText(save.error)}
            </p>
          )}
          <Actions summary={summary}>
            <button
              type="button"
              className={`${ui.btnPrimary} w-full`}
              disabled={lineInputs.length === 0 || gone.length > 0 || save.isPending}
              onClick={() => save.mutate()}
            >
              Lưu thay đổi
            </button>
          </Actions>
        </>
      }
    >
      {gone.map((l) => (
        <div key={l.itemId} className="flex flex-col gap-2 rounded-card border border-stone-200 bg-stone-0 p-3">
          <p className="text-sm font-semibold text-stone-900">{`${l.itemName}: ${formatCount(l.declaredQty)} ${l.unitLabel}`}</p>
          <p className="text-xs text-danger-fg">Món này hiện chưa nhận</p>
          <div>
            <button type="button" className={ui.btnSecondary} onClick={() => setLine(l.itemId, 0)}>
              Bỏ món này
            </button>
          </div>
        </div>
      ))}
      <WasteItemStep
        items={me.items}
        lines={lines}
        onChange={setLine}
        allowance={Object.fromEntries(r.lines.map((l) => [l.itemId, l.declaredQty]))}
      />
      {isDropOff && shownPoint && (
        <div className="flex flex-col gap-2">
          <div>
            <p className="text-sm font-semibold text-stone-900">{shownPoint.name}</p>
            <p className="text-xs text-stone-600">{pointAddress(shownPoint)}</p>
          </div>
          <div>
            <button type="button" className={ui.btnSecondary} onClick={changePoint}>
              Đổi điểm nhận
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}
