import { useEffect, useRef, useState } from 'react';
import { Page, useLocation, useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import type { WasteMethod, WastePointDTO } from '@tubutree/shared-types';
import { WASTE_QUERY_KEYS, getNearbyWastePoints, getWasteMe, getWastePoints } from '../services/waste-api';
import { getZaloAccessToken, requestZaloLocation } from '../services/zmp-bridge';
import { getLoadErrorMessage } from '../services/api';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { usePublicConfig } from '../hooks/use-public-config';
import { SessionUnavailable } from '../components/ui/auth-gate';
import { Button } from '../components/ui/button';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { PageHeader } from '../components/ui/page-header';
import { SearchField } from '../components/ui/search-field';
import { SegmentedTabs } from '../components/ui/segmented-tabs';
import { Skeleton } from '../components/ui/skeleton';
import { StickyActionBar } from '../components/ui/sticky-action-bar';
import { Text } from '../components/ui/text';
import { wasteStepCopy, warehouseOnlyPointsNote } from '@tubutree/app-core/waste-copy';
import { WastePhoneNeeded, isWasteForbidden } from '../components/waste-phone-needed';
import { WastePointPicker } from '../components/waste-point-picker';
import { METHOD_LABELS } from '../utils/waste-labels';
import type { WastePointsNavState, WastePointsReturnState } from './recycle-new';

const WIZARD_METHOD_STEP = '/recycle/new?step=method';
const SWITCH_METHODS: readonly WasteMethod[] = ['MAIL_IN', 'PICKUP'];
const NEAR_TAB = 'near';
const COLUMN = { display: 'flex', flexDirection: 'column' } as const;

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();

/** Khớp không phân biệt hoa thường và dấu trên tên điểm, phường/xã và tên đường. */
export function filterPointsByText(points: readonly WastePointDTO[], q: string): WastePointDTO[] {
  const needle = fold(q.trim());
  if (!needle) return [...points];
  return points.filter((p) => [p.name, p.communeName, p.addressLine].some((field) => fold(field).includes(needle)));
}

export default function RecyclePointsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const phase = useAuthPhase();
  const cfg = usePublicConfig();
  const nav = location.state as WastePointsNavState | null;

  useEffect(() => {
    if (phase === 'guest') navigate('/recycle', { replace: true });
    else if (!nav) navigate('/recycle/new', { replace: true });
  }, [nav, phase, navigate]);

  const meQ = useQuery({ queryKey: WASTE_QUERY_KEYS.me, queryFn: getWasteMe, enabled: phase === 'authenticated' });
  const pointsQ = useQuery({
    queryKey: WASTE_QUERY_KEYS.points(null),
    queryFn: () => getWastePoints(),
    enabled: phase === 'authenticated',
  });
  const me = meQ.data;
  const points = pointsQ.data;

  const [nearby, setNearby] = useState<WastePointDTO[] | null>(nav?.draft.nearby ?? null);
  const [tabSel, setTab] = useState<string | null>(nav?.draft.nearby?.length ? NEAR_TAB : null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const locationBusy = useRef(false);

  const provinces: { code: string; name: string }[] = [];
  for (const p of points ?? []) {
    if (!provinces.some((x) => x.code === p.provinceCode)) provinces.push({ code: p.provinceCode, name: p.provinceName });
  }
  const hasNear = !!nearby?.length;
  const tabItems = [
    ...(hasNear ? [{ key: NEAR_TAB, label: 'Gần tôi' }] : []),
    ...provinces.map((x) => ({ key: x.code, label: x.name })),
  ];
  const wanted = tabSel ?? provinces[0]?.code ?? '';
  const tab = wanted === NEAR_TAB && !hasNear ? (provinces[0]?.code ?? '') : wanted;

  const takeLocation = async () => {
    if (locationBusy.current) return;
    locationBusy.current = true;
    setLocating(true);
    try {
      const loc = await requestZaloLocation();
      if (!loc) return;
      const { accessToken } = await getZaloAccessToken();
      const r = await getNearbyWastePoints({ locationToken: loc.token, zaloAccessToken: accessToken });
      // No distance at all means the server could not resolve the location (spec 4.4): same as a refusal.
      if (r.some((p) => p.distanceKm != null)) {
        setNearby(r);
        setTab(NEAR_TAB);
      }
    } catch {
      // Location only adds a group; a failure shows nothing (spec 4.4, 14.8, 16.1).
    } finally {
      locationBusy.current = false;
      setLocating(false);
    }
  };

  const shell = (content: React.ReactNode, bar?: React.ReactNode) => (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title={wasteStepCopy.points} />
      <div style={{ ...COLUMN, padding: 16, paddingBottom: 120, gap: 16 }}>{content}</div>
      {bar}
    </Page>
  );
  const skeleton = (
    <>
      <Skeleton height={80} radius="var(--radius-card)" />
      <Skeleton height={80} radius="var(--radius-card)" />
      <Skeleton height={80} radius="var(--radius-card)" />
    </>
  );

  if (phase === 'unavailable') return shell(<SessionUnavailable />);
  if (!nav) return shell(skeleton);
  const loadError = (phase === 'authenticated' && meQ.isError && meQ.error) || (pointsQ.isError && pointsQ.error);
  if (loadError && isWasteForbidden(loadError)) return shell(<WastePhoneNeeded text="Cho Tubu số điện thoại để chọn điểm nhận." />);
  if (loadError) {
    return shell(
      <ErrorState
        message={getLoadErrorMessage(loadError)}
        onRetry={() => {
          void meQ.refetch();
          void pointsQ.refetch();
        }}
      />,
    );
  }
  if (!me || !points) return shell(skeleton);

  const source = tab === NEAR_TAB ? (nearby ?? []) : points.filter((p) => p.provinceCode === tab);
  const list = filterPointsByText(source, q);
  const warehouseOnlyNames = me.items.filter((i) => nav.selectedItemIds.includes(i.id) && i.warehouseOnly).map((i) => i.name);
  const pickedPoint = list.find((p) => p.id === picked) ?? null;
  const canChoose =
    pickedPoint !== null && !pickedPoint.quotaFull && nav.selectedItemIds.every((id) => pickedPoint.acceptedItemIds.includes(id));

  const choose = () => {
    if (!pickedPoint || !canChoose) return;
    const state = {
      draft: { ...nav.draft, nearby: nav.draft.nearby ?? nearby, method: 'DROP_OFF', pointId: pickedPoint.id, pickedPoint },
    } satisfies WastePointsReturnState;
    navigate(nav.returnTo, { replace: true, state });
  };

  const canSwitchMethod = nav.returnTo === WIZARD_METHOD_STEP && !me.shipLockedAt;
  const switchMethods = canSwitchMethod
    ? SWITCH_METHODS.filter((m) => (m === 'MAIL_IN' ? cfg.waste.mailin && me.laneFlags.mailin : cfg.waste.pickup && me.laneFlags.pickup))
    : [];
  const switchMethod = (m: WasteMethod) => {
    const state = { draft: { ...nav.draft, method: m } } satisfies WastePointsReturnState;
    navigate(nav.returnTo, { replace: true, state });
  };

  return shell(
    <>
      {warehouseOnlyNames.length > 0 && (
        <Text variant="body-sm" tone="secondary" as="p" style={{ margin: 0 }}>
          {warehouseOnlyPointsNote(warehouseOnlyNames, points.some((p) => p.kind === 'WAREHOUSE'))}
        </Text>
      )}
      <SearchField
        label="Tìm điểm nhận"
        placeholder="Tên điểm, phường/xã hoặc tên đường"
        clearLabel="Xoá tìm kiếm"
        value={q}
        onChange={setQ}
        onSubmit={setQ}
      />
      {nearby === null && (
        <Button variant="secondary" icon={MapPin} loading={locating} onPress={() => void takeLocation()}>
          Dùng vị trí của tôi
        </Button>
      )}
      {tabItems.length > 0 && <SegmentedTabs scroll value={tab} onChange={setTab} items={tabItems} />}
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
        <EmptyState art="search" variant="inline" heading="Không tìm thấy điểm nhận nào" />
      )}
      <section style={{ ...COLUMN, gap: 8 }}>
        <Text variant="body-md" as="p" style={{ fontWeight: 600, margin: 0 }}>
          Chưa có điểm gần bạn?
        </Text>
        <Text variant="body-sm" tone="secondary" as="p" style={{ margin: 0 }}>
          Gửi gói nhỏ qua hãng vận chuyển thường tốn hơn giá trị điểm.
        </Text>
        {switchMethods.map((m) => (
          <Button key={m} variant="secondary" onPress={() => switchMethod(m)}>
            {METHOD_LABELS[m]}
          </Button>
        ))}
      </section>
    </>,
    <StickyActionBar
      primary={
        <Button fullWidth disabled={!canChoose} onPress={choose}>
          Chọn điểm này
        </Button>
      }
    />,
  );
}
