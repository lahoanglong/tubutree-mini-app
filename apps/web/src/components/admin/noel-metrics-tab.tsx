'use client';

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { NoelMetricsDTO, NoelRetentionGroup, NoelWindowDays } from '@tubutree/shared-types';
import { getNoelMetrics } from '@/lib/admin-client';
import { BTN_SECONDARY, ListSkeleton, LoadError, Notice, ScrollRegion, chipClass } from '@/components/admin/ui';
import { formatUpdatedAt } from '@/components/admin/launch-watch-format';
import {
  NOEL_WINDOWS,
  barPercent,
  dayLabel,
  economyAlerts,
  formatAvgScore,
  formatCount,
  formatDecimal,
  formatPct,
  gameLabel,
  MIN_RETENTION_SAMPLE,
  ornamentLabel,
  rangeLabel,
  retentionGap,
  retentionSampleSmall,
} from '@/components/admin/noel-metrics-format';

export function NoelMetricsTab() {
  const [days, setDays] = useState<NoelWindowDays>(7);
  const q = useQuery({ queryKey: ['admin-noel-metrics', days], queryFn: () => getNoelMetrics(days), staleTime: 30_000 });
  const data = q.data;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="mr-auto font-display text-lg font-semibold text-stone-900">Noel Xanh</h2>
        <div role="group" aria-label="Khoảng thời gian" className="flex gap-1.5">
          {NOEL_WINDOWS.map((o) => (
            <button key={o.days} type="button" aria-pressed={days === o.days} onClick={() => setDays(o.days)} className={chipClass(days === o.days)}>
              {o.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            if (!q.isFetching) void q.refetch();
          }}
          aria-disabled={q.isFetching || undefined}
          aria-busy={q.isFetching || undefined}
          className={`${BTN_SECONDARY} aria-disabled:opacity-60`}
        >
          Làm mới
        </button>
      </header>

      {q.isLoading ? (
        <ListSkeleton label="Đang tải số liệu Noel" rows={4} className="h-24" />
      ) : q.isError || !data ? (
        <LoadError message="Không tải được số liệu Noel." onRetry={() => q.refetch()} retrying={q.isFetching} />
      ) : (
        <NoelBody data={data} />
      )}
    </div>
  );
}

function NoelBody({ data }: { data: NoelMetricsDTO }) {
  return (
    <>
      <p className="text-xs text-stone-500">
        Ngày theo giờ Việt Nam, từ {rangeLabel(data.fromDayKey, data.toDayKey)}; hôm nay chưa đủ ngày. Cập nhật lúc {formatUpdatedAt(data.generatedAt)}.
      </p>
      <Cards data={data} />
      <ClaimsBlock data={data} />
      <AdventBlock data={data} />
      <OrnamentsBlock data={data} />
      <GamesBlock data={data} />
      <EconomyBlock data={data} />
      <RetentionBlock data={data} />
    </>
  );
}

function Block({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="text-base font-semibold text-stone-900">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-stone-500">{hint}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-card border border-stone-200 bg-stone-0 p-3">
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums text-stone-900">{value}</dd>
      {sub && <p className="mt-0.5 text-xs tabular-nums text-stone-500">{sub}</p>}
    </div>
  );
}

function Cards({ data }: { data: NoelMetricsDTO }) {
  const perDay = data.days > 0 ? data.claims.claims / data.days : 0;
  return (
    <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Tóm tắt Noel">
      <Card label="Khách điểm danh nhận quà" value={formatCount(data.claims.users)} sub={`${formatCount(data.claims.claims)} lượt · TB ${formatDecimal(perDay)}/ngày`} />
      <Card
        label="Hoàn thành lịch quà"
        value={formatPct(data.advent.completionPct)}
        sub={data.advent.completed === null ? (data.advent.phase === 'before' ? 'Chưa tới 14/12' : 'Tính từ ngày thứ 2') : `${formatCount(data.advent.completed)}/${formatCount(data.advent.openedAny)} khách`}
      />
      <Card label="Bấm chia sẻ thiệp" value={formatCount(data.share.taps)} sub={`${formatCount(data.share.users)} khách`} />
      <Card
        label="Tắt tuyết"
        value={formatPct(data.snow.offSharePct)}
        sub={`${formatCount(data.snow.off.taps)} lượt tắt · ${formatCount(data.snow.on.taps)} lượt bật`}
      />
    </dl>
  );
}

function ClaimsBlock({ data }: { data: NoelMetricsDTO }) {
  const max = Math.max(0, ...data.claims.perDay.map((d) => d.count));
  return (
    <Block title="Nhận quà theo ngày" hint="Mỗi lượt là một lần điểm danh ngày: cây thông mở quà bằng đúng lần điểm danh này, nên điểm danh ở Vườn Xanh cũng được đếm. Mỗi khách tối đa một lượt mỗi ngày.">
      {data.claims.claims === 0 ? (
        <p className="text-sm text-stone-500">Chưa có khách nhận quà trong khoảng này.</p>
      ) : (
        <table className="w-full text-sm tabular-nums">
          <thead className="sr-only">
            <tr>
              <th scope="col">Ngày</th>
              <th scope="col">Số khách nhận quà</th>
            </tr>
          </thead>
          <tbody>
            {data.claims.perDay.map((d) => (
              <tr key={d.dayKey} className="border-t border-stone-100">
                <th scope="row" className="w-14 py-1 pr-2 text-left font-normal text-stone-700">{dayLabel(d.dayKey)}</th>
                <td className="w-12 pr-2 text-right font-medium text-stone-900">{formatCount(d.count)}</td>
                <td className="py-1">
                  <div className="h-2 rounded-full bg-forest-600" style={{ width: `${barPercent(d.count, max)}%` }} aria-hidden="true" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Block>
  );
}

function AdventBlock({ data }: { data: NoelMetricsDTO }) {
  const a = data.advent;
  const max = Math.max(0, ...a.opensByDay.map((d) => d.users));
  const note =
    a.phase === 'before'
      ? 'Lịch quà bắt đầu từ 14/12, chưa có ô nào tới ngày.'
      : a.phase === 'after'
        ? 'Lịch quà đã kết thúc (ngày cuối 25/12).'
        : `Đã tới ô ${a.daysElapsed}/12.`;
  return (
    <Block
      title="Lịch quà 12 ngày"
      hint={`Số khách mở quà từng ngày từ 14/12/${a.year}. Hoàn thành là khách đã mở đủ mọi ô từ 14/12 tới hôm qua (ô hôm nay chưa tính vì chưa hết ngày). Không đổi theo khoảng thời gian ở trên.`}
    >
      <p className="text-sm text-stone-700">{note}</p>
      {a.daysElapsed > 0 && (
        <p className="mt-1 text-sm tabular-nums text-stone-900">
          Mở ít nhất một ô: <strong>{formatCount(a.openedAny)}</strong> khách
          {a.requiredDays > 0 ? (
            <>
              {' '}· mở đủ {a.requiredDays} ô{a.phase === 'after' ? '' : ' tới hôm qua'}: <strong>{formatCount(a.completed ?? 0)}</strong> khách ({formatPct(a.completionPct)})
            </>
          ) : (
            <> · tỉ lệ hoàn thành tính từ ngày thứ 2</>
          )}
        </p>
      )}
      <table className="mt-2 w-full text-sm tabular-nums">
        <thead className="sr-only">
          <tr>
            <th scope="col">Ô</th>
            <th scope="col">Số khách mở</th>
          </tr>
        </thead>
        <tbody>
          {a.opensByDay.map((d, i) => {
            const future = i >= a.daysElapsed;
            return (
              <tr key={d.dayKey} className="border-t border-stone-100">
                <th scope="row" className="w-24 py-1 pr-2 text-left font-normal text-stone-700">
                  Ô {d.day} · {dayLabel(d.dayKey)}
                </th>
                <td className="w-12 pr-2 text-right font-medium text-stone-900">{future ? '—' : formatCount(d.users)}</td>
                <td className="py-1">
                  {!future && <div className="h-2 rounded-full bg-forest-600" style={{ width: `${barPercent(d.users, max)}%` }} aria-hidden="true" />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Block>
  );
}

function OrnamentsBlock({ data }: { data: NoelMetricsDTO }) {
  const any = data.ornaments.some((o) => o.unlock.taps + o.hang.taps + o.remove.taps > 0);
  return (
    <Block
      title="Trang trí cây thông"
      hint="Mở khoá là lần đầu khách chạm món đã đủ điều kiện. Treo là treo lại món đã mở. Số trong ngoặc là khách khác nhau."
    >
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="text-left text-stone-500">
            <th scope="col" className="py-1 pr-2 font-medium">Món</th>
            <th scope="col" className="px-1 text-right font-medium">Mở khoá</th>
            <th scope="col" className="px-1 text-right font-medium">Treo</th>
            <th scope="col" className="pl-1 text-right font-medium">Gỡ</th>
          </tr>
        </thead>
        <tbody>
          {data.ornaments.map((o) => (
            <tr key={o.slot} className="border-t border-stone-100">
              <th scope="row" className="py-1.5 pr-2 text-left font-normal text-stone-900">{ornamentLabel(o.slot)}</th>
              <td className="px-1 text-right">{formatCount(o.unlock.taps)} <span className="text-stone-500">({formatCount(o.unlock.users)})</span></td>
              <td className="px-1 text-right">{formatCount(o.hang.taps)} <span className="text-stone-500">({formatCount(o.hang.users)})</span></td>
              <td className="pl-1 text-right">{formatCount(o.remove.taps)} <span className="text-stone-500">({formatCount(o.remove.users)})</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!any && <p className="mt-2 text-sm text-stone-500">Chưa có khách trang trí cây trong khoảng này.</p>}
      <p className="mt-2 text-xs text-stone-500 tabular-nums">
        Đủ điều kiện theo chuỗi điểm danh trong khoảng: từ 3 ngày liền <strong>{formatCount(data.claims.reachedStreak3)}</strong> khách (Quả châu đỏ), từ 7 ngày liền{' '}
        <strong>{formatCount(data.claims.reachedStreak7)}</strong> khách (Tuần lộc mini).
      </p>
    </Block>
  );
}

function GamesBlock({ data }: { data: NoelMetricsDTO }) {
  return (
    <Block
      title="Game trong Sảnh"
      hint="Ván là lượt nộp kết quả. Điểm TB: điểm với game arcade, số câu đúng hoặc bậc đạt trên tối đa với game mini. Hứng Giọt Sương và Phân Loại Vỏ Chai Thần Tốc chỉ đếm ván từ lúc tab này ra mắt, vì trước đó máy chủ chỉ lưu kỷ lục."
    >
      <ScrollRegion label="Bảng game theo ván">
        <table className="w-full min-w-[420px] text-sm tabular-nums">
          <thead>
            <tr className="text-left text-stone-500">
              <th scope="col" className="py-1 pr-2 font-medium">Game</th>
              <th scope="col" className="px-1 text-right font-medium">Ván</th>
              <th scope="col" className="px-1 text-right font-medium">Khách</th>
              <th scope="col" className="px-1 text-right font-medium">Điểm TB</th>
              <th scope="col" className="px-1 text-right font-medium">Có thưởng</th>
              <th scope="col" className="px-1 text-right font-medium">Giọt nước</th>
              <th scope="col" className="pl-1 text-right font-medium">Điểm Xanh</th>
            </tr>
          </thead>
          <tbody>
            {data.games.map((g) => (
              <tr key={g.game} className="border-t border-stone-100">
                <th scope="row" className="py-1.5 pr-2 text-left font-normal text-stone-900">{gameLabel(g.game)}</th>
                <td className="px-1 text-right">{formatCount(g.plays)}</td>
                <td className="px-1 text-right">{formatCount(g.users)}</td>
                <td className="px-1 text-right">{formatAvgScore(g.avgScore, g.avgOutOf)}</td>
                <td className="px-1 text-right">{formatCount(g.rewardedPlays)}</td>
                <td className="px-1 text-right">{formatCount(g.water)}</td>
                <td className="pl-1 text-right">{formatCount(g.points)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </Block>
  );
}

function EconomyBlock({ data }: { data: NoelMetricsDTO }) {
  const e = data.economy;
  const alerts = economyAlerts(e);
  const rows: Array<[string, string, string]> = [
    ['Khách nhận thưởng game mini', formatCount(e.current.miniUsers), formatCount(e.previous.miniUsers)],
    ['Ván mini có thưởng', formatCount(e.current.miniRewardedRounds), formatCount(e.previous.miniRewardedRounds)],
    ['Giọt nước phát từ game mini', formatCount(e.current.miniWater), formatCount(e.previous.miniWater)],
    ['Điểm Xanh phát từ game mini', formatCount(e.current.miniPoints), formatCount(e.previous.miniPoints)],
    [`Nhiều nhất một khách một ngày: giọt nước (trần ${formatCount(e.caps.miniWaterPerUserDay)})`, formatCount(e.current.maxUserWaterInDay), formatCount(e.previous.maxUserWaterInDay)],
    [`Nhiều nhất một khách một ngày: Điểm Xanh (trần ${formatCount(e.caps.miniPointsPerUserDay)})`, formatCount(e.current.maxUserPointsInDay), formatCount(e.previous.maxUserPointsInDay)],
    [`Điểm Xanh game phát nhiều nhất một ngày (ngân sách ${formatCount(e.caps.miniGlobalPointsPerDay)})`, formatCount(e.current.maxGlobalPointsInDay), formatCount(e.previous.maxGlobalPointsInDay)],
    ['Lượt arcade có thưởng', formatCount(e.current.arcadeRewardedRuns), formatCount(e.previous.arcadeRewardedRuns)],
    ['Giọt nước phát từ arcade', formatCount(e.current.arcadeWater), formatCount(e.previous.arcadeWater)],
  ];
  return (
    <Block title="Thưởng game đã phát" hint="Lấy từ sổ thưởng, so với khoảng liền trước cùng số ngày. Trần chặn khi cộng thưởng; ô đỏ chỉ hiện nếu số liệu vượt trần.">
      <div className="space-y-1.5">
        {alerts.map((a) => (
          <Notice key={a.message} tone={a.level === 'red' ? 'danger' : 'warning'} role={a.level === 'red' ? 'alert' : 'status'}>
            {a.message}
          </Notice>
        ))}
        {alerts.length === 0 && <Notice tone="success">Chưa thấy thưởng game vượt trần hay tăng bất thường so với khoảng trước.</Notice>}
      </div>
      <table className="mt-2 w-full text-sm tabular-nums">
        <thead>
          <tr className="text-left text-stone-500">
            <th scope="col" className="py-1 pr-2 font-medium">Chỉ số</th>
            <th scope="col" className="px-1 text-right font-medium">{rangeLabel(e.current.fromDayKey, e.current.toDayKey)}</th>
            <th scope="col" className="pl-1 text-right font-medium">{rangeLabel(e.previous.fromDayKey, e.previous.toDayKey)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, now, before]) => (
            <tr key={label} className="border-t border-stone-100 align-top">
              <th scope="row" className="py-1.5 pr-2 text-left font-normal text-stone-900">{label}</th>
              <td className="px-1 py-1.5 text-right font-medium">{now}</td>
              <td className="py-1.5 pl-1 text-right text-stone-700">{before}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Block>
  );
}

function RetentionCard({ title, g }: { title: string; g: NoelRetentionGroup }) {
  return (
    <div className="rounded-card border border-stone-200 bg-stone-0 p-3">
      <h4 className="text-sm font-semibold text-stone-900">{title}</h4>
      <p className="mt-1 text-xl font-semibold tabular-nums text-stone-900">{formatPct(g.ratePct)}</p>
      <p className="text-xs tabular-nums text-stone-500">
        {formatCount(g.returned)}/{formatCount(g.userDays)} lượt khách-ngày quay lại hôm sau
      </p>
    </div>
  );
}

function RetentionBlock({ data }: { data: NoelMetricsDTO }) {
  const r = data.retention;
  const gap = retentionGap(r.noel, r.other);
  const small = retentionSampleSmall(r);
  return (
    <Block
      title="Quay lại hôm sau (D+1)"
      hint={`Khách đã đăng nhập, ngày ${rangeLabel(r.cohortFromDayKey, r.cohortToDayKey)} (chỉ lấy ngày đã đủ ngày kế tiếp). Nhóm Noel là có điểm danh nhận quà hoặc thao tác với cây, tuyết, thiệp trong ngày; điểm danh cũng làm được ở Vườn Xanh và trước khi bật mùa Noel, nên nhóm này chưa riêng cho người dùng Noel. Quay lại là có mặt trong app hôm sau.`}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <RetentionCard title="Có điểm danh hoặc thao tác Noel" g={r.noel} />
        <RetentionCard title="Không điểm danh, không thao tác Noel" g={r.other} />
      </div>
      {gap && <p className="mt-2 text-sm text-stone-900">Chênh lệch: <strong>{gap}</strong>.</p>}
      {small && <Notice tone="warning">{`Mẫu còn nhỏ (dưới ${MIN_RETENTION_SAMPLE} lượt khách-ngày ở một nhóm), chưa đủ để kết luận.`}</Notice>}
      <p className="mt-2 text-xs text-stone-500">Chỉ so sánh hai nhóm. Người chăm vào app vốn hay quay lại hơn, nên số này chưa chứng minh Noel là nguyên nhân.</p>
    </Block>
  );
}
