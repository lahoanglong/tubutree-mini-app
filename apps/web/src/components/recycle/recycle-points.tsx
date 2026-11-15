'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Loader2, MapPin, Search } from 'lucide-react';
import type { WasteMethod, WastePointDTO } from '@tubutree/shared-types';
import { wasteMeQuery, wastePointsQuery } from '@tubutree/app-core/queries/waste';
import { friendlyError as errText } from '@/lib/friendly-error';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { ui } from '@/lib/guest-ui';
import { skin } from '@/components/pro-shared/mini-skin';
import { loadPointsNav, saveReturn, type WastePointsNav } from '@/lib/recycle-wizard';
import { usePublicConfig } from '@/lib/use-public-config';
import { includesFolded } from '@/lib/vn-fold';
import { AuthLoading, SessionUnavailable } from '@/components/login-required';
import { StickyActionBar } from '@/components/sticky-action-bar';
import { ErrorState } from '@/components/ui/error-state';
import { wasteStepCopy, warehouseOnlyPointsNote } from '@tubutree/app-core/waste-copy';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { METHOD_LABELS } from './recycle-labels';
import { WastePointPicker } from './waste-point-picker';
import { WebRecyclePhoneCard } from './web-recycle-phone-card';

const WIZARD_METHOD_STEP = '/doi-rac/tao?step=method';
const SWITCH_METHODS: readonly WasteMethod[] = ['MAIL_IN', 'PICKUP'];
const NEAR_TAB = 'near';
const EARTH_RADIUS_KM = 6371;

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function rankPointsByCoords(
  points: readonly WastePointDTO[],
  coords: { lat: number; lng: number },
): WastePointDTO[] {
  const located: WastePointDTO[] = [];
  const rest: WastePointDTO[] = [];
  for (const p of points) {
    if (p.lat != null && p.lng != null) {
      located.push({
        ...p,
        distanceKm: Math.round(haversineKm(coords, { lat: p.lat, lng: p.lng }) * 10) / 10,
      });
    } else {
      rest.push(p);
    }
  }
  located.sort((a, b) => (a.distanceKm as number) - (b.distanceKm as number));
  return [...located, ...rest];
}

/** Khớp không phân biệt hoa thường và dấu trên tên điểm, phường/xã và tên đường. */
export function filterPointsByText(points: readonly WastePointDTO[], q: string): WastePointDTO[] {
  if (!q.trim()) return [...points];
  return points.filter((p) => [p.name, p.communeName, p.addressLine].some((field) => includesFolded(field, q)));
}

export function RecyclePoints() {
  const router = useRouter();
  const phase = useAuthPhase();
  const cfg = usePublicConfig();
  const authed = phase === 'authenticated';

  const [nav, setNav] = useState<WastePointsNav | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setNav(loadPointsNav());
    setReady(true);
  }, []);
  useEffect(() => {
    if (phase === 'guest') router.replace('/doi-rac');
    else if (ready && !nav && phase !== 'loading') router.replace('/doi-rac/tao');
  }, [ready, nav, phase, router]);

  const meQ = useQuery({ ...wasteMeQuery(coreHttp), enabled: authed && !!nav });
  const me = meQ.data;
  const eligible = me?.eligibility === 'OK';
  const pointsQ = useQuery({
    ...wastePointsQuery(coreHttp, null),
    enabled: authed && !!nav && (me === undefined || eligible),
  });
  const points = pointsQ.data;
  const leave = me !== undefined && (!me.programmeEnabled || me.blocked || me.eligibility === 'GUEST');
  useEffect(() => {
    if (leave) router.replace('/doi-rac');
  }, [leave, router]);

  const [nearby, setNearby] = useState<WastePointDTO[] | null>(null);
  const [tabSel, setTab] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoHint, setGeoHint] = useState<string | null>(null);
  const locateBusy = useRef(false);

  const provinces = useMemo(() => {
    const out: { code: string; name: string }[] = [];
    for (const p of points ?? []) if (!out.some((x) => x.code === p.provinceCode)) out.push({ code: p.provinceCode, name: p.provinceName });
    return out;
  }, [points]);
  const hasNear = !!nearby?.length;
  const wantedTab = tabSel ?? provinces[0]?.code ?? '';
  const tab = wantedTab === NEAR_TAB && !hasNear ? (provinces[0]?.code ?? '') : wantedTab;

  const findNearby = () => {
    if (locateBusy.current || !points) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoHint('Trình duyệt chưa hỗ trợ định vị — bạn chọn tỉnh hoặc gõ tên đường ở ô tìm kiếm nhé.');
      return;
    }
    locateBusy.current = true;
    setLocating(true);
    setGeoHint(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        locateBusy.current = false;
        setLocating(false);
        const ranked = rankPointsByCoords(points, {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        if (ranked.some((p) => p.distanceKm != null)) {
          setNearby(ranked);
          setTab(NEAR_TAB);
        } else {
          setGeoHint('Đã nhận vị trí — hiện các điểm thu gom đang lọc theo tỉnh bên dưới.');
        }
      },
      () => {
        locateBusy.current = false;
        setLocating(false);
        setGeoHint('Chưa lấy được vị trí trình duyệt — bạn chọn tỉnh hoặc gõ tên đường ở ô tìm kiếm nhé.');
      },
      { timeout: 8000, enableHighAccuracy: false },
    );
  };

  const shell = (content: ReactNode, bar?: ReactNode) => (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-6 pb-12 tabular-nums">
      <PageHeader title={wasteStepCopy.points} backHref={nav?.returnTo ?? '/doi-rac/tao'} backLabel="Quay lại" />
      {content}
      {bar}
    </main>
  );
  const skeleton = (
    <>
      <Skeleton height={80} rounded="rounded-card" />
      <Skeleton height={80} rounded="rounded-card" />
      <Skeleton height={80} rounded="rounded-card" />
    </>
  );

  if (phase === 'loading') return shell(<AuthLoading />);
  if (phase === 'unavailable') return shell(<SessionUnavailable />);
  if (phase === 'guest') return shell(skeleton);
  if (!ready || !nav) return shell(skeleton);
  if (me && !leave && me.eligibility !== 'OK') return shell(<WebRecyclePhoneCard />);
  const loadError = (meQ.isError && meQ.error) || (pointsQ.isError && pointsQ.error);
  if (loadError) {
    return shell(
      <ErrorState
        message={errText(loadError)}
        onRetry={() => Promise.all([meQ.refetch(), pointsQ.refetch()])}
      />,
    );
  }
  if (!me || !points || leave) return shell(skeleton);

  const tabItems = [
    ...(hasNear ? [{ key: NEAR_TAB, label: 'Gần tôi' }] : []),
    ...provinces.map((x) => ({ key: x.code, label: x.name })),
  ];
  const source = tab === NEAR_TAB ? (nearby ?? []) : points.filter((p) => p.provinceCode === tab);
  const list = filterPointsByText(source, q);
  const warehouseOnlyNames = me.items.filter((i) => nav.selectedItemIds.includes(i.id) && i.warehouseOnly).map((i) => i.name);
  const pickedPoint = list.find((p) => p.id === picked) ?? null;
  const canChoose =
    pickedPoint !== null && !pickedPoint.quotaFull && nav.selectedItemIds.every((id) => pickedPoint.acceptedItemIds.includes(id));

  const choose = () => {
    if (!pickedPoint || !canChoose) return;
    saveReturn({ ...nav.draft, method: 'DROP_OFF', pointId: pickedPoint.id, pickedPoint });
    router.replace(nav.returnTo);
  };

  const canSwitchMethod = nav.returnTo === WIZARD_METHOD_STEP && !me.shipLockedAt;
  const switchMethods = canSwitchMethod
    ? SWITCH_METHODS.filter((m) => (m === 'MAIL_IN' ? cfg.waste.mailin && me.laneFlags.mailin : cfg.waste.pickup && me.laneFlags.pickup))
    : [];
  const switchMethod = (m: WasteMethod) => {
    saveReturn({ ...nav.draft, method: m });
    router.replace(nav.returnTo);
  };

  const chooseButton = (
    <button type="button" className={`${ui.btnPrimary} w-full`} disabled={!canChoose} onClick={choose}>
      Chọn điểm này
    </button>
  );

  return shell(
    <>
      {warehouseOnlyNames.length > 0 && (
        <p className="text-sm text-stone-600">{warehouseOnlyPointsNote(warehouseOnlyNames, points.some((p) => p.kind === 'WAREHOUSE'))}</p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" aria-hidden="true" />
          <input
            type="search"
            aria-label="Tìm điểm nhận"
            placeholder="Tên điểm, phường/xã hoặc tên đường"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className={`${ui.field} pl-9`}
          />
        </div>
        {nearby === null && (
          <button
            type="button"
            aria-busy={locating || undefined}
            aria-disabled={locating || undefined}
            onClick={findNearby}
            className={`${skin.btnSecondary} shrink-0`}
          >
            {locating ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <MapPin className="mr-1.5 h-4 w-4 text-forest-600" aria-hidden="true" />
            )}
            📍 Tìm điểm thu gom gần tôi
          </button>
        )}
      </div>
      {geoHint && (
        <p role="status" className="text-xs text-stone-600">
          {geoHint}
        </p>
      )}
      {tabItems.length > 0 && <SegmentedTabs scroll value={tab} onChange={setTab} items={tabItems} label="Tỉnh" />}
      {list.length > 0 ? (
        <WastePointPicker
          points={list}
          value={picked}
          onChange={setPicked}
          items={me.items.filter((i) => i.status === 'ACTIVE')}
          selectedItemIds={nav.selectedItemIds}
          showDistance={tab === NEAR_TAB}
        />
      ) : (
        <p className={`${skin.card} p-6 text-center text-sm text-stone-700`}>Không tìm thấy điểm nhận nào</p>
      )}
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-stone-900">Chưa có điểm gần bạn?</h2>
        <p className="text-sm text-stone-700">Gửi gói nhỏ qua hãng vận chuyển thường tốn hơn giá trị điểm.</p>
        <div className="flex flex-wrap gap-2">
          {switchMethods.map((m) => (
            <button key={m} type="button" className={skin.btnSecondary} onClick={() => switchMethod(m)}>
              {METHOD_LABELS[m]}
            </button>
          ))}
        </div>
      </section>
      <div data-desktop-action className="hidden md:block">
        {chooseButton}
      </div>
      <StickyActionBar label="Chọn điểm nhận">{chooseButton}</StickyActionBar>
    </>,
  );
}
