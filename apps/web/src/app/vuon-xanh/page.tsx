'use client';

import { Suspense, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Recycle } from 'lucide-react';
import type { AnswerResult } from '@tubutree/app-core/api/game';
import { useAuthPhase } from '@/lib/auth-phase';
import { isWebRouteReady } from '@/lib/route-map';
import { usePublicConfig } from '@/lib/use-public-config';
import { AuthLoading, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedTabs, useTabParam } from '@/components/ui/segmented-tabs';
import { CheckInStreak } from '@/components/game/checkin-streak';
import { EcoImpact } from '@/components/game/eco-impact';
import { GameLinkRow } from '@/components/game/game-link-row';
import { GameNoticeBar, useGameNotice } from '@/components/game/game-notice';
import { GameLoginGate, GameSkeleton } from '@/components/game/game-states';
import { GAME_TAB_KEYS, GAME_TABS, GameTabPanel, type GameTabKey } from '@/components/game/game-tabs';
import { GardenHero } from '@/components/game/garden-hero';
import { LuckyWheelCard } from '@/components/game/lucky-wheel-card';
import { MissionsCard } from '@/components/game/missions-card';
import { QuizCard, type QuizReveal } from '@/components/game/quiz-card';
import { SeasonBanner } from '@/components/game/season-banner';
import { StreakRepair } from '@/components/game/streak-repair';
import { TreeActions } from '@/components/game/tree-actions';
import { TreeHealthAlert } from '@/components/game/tree-health-alert';
import { useGameActions } from '@/components/game/use-game-actions';
import { useGameData } from '@/components/game/use-game-data';
import { useWheelPrize } from '@/components/game/use-wheel-prize';
import { WheelPrizeSheet } from '@/components/game/wheel-prize-sheet';

const TITLE = 'Vườn Xanh';
const WASTE_PATH = '/doi-rac';

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');

function GameBody() {
  const router = useRouter();
  const publicConfig = usePublicConfig();
  const { notice, notify } = useGameNotice();
  const [tab, setTab] = useTabParam(GAME_TAB_KEYS, 'today');
  const { profileQ, quiz, missions, forest, season } = useGameData(true);
  const { data: profile, isLoading, isError, error: profileError, refetch } = profileQ;

  // Quiz nhiều câu/ngày: theo dõi câu đã trả lời phía trình duyệt để hiện câu kế tiếp (§6.7.8).
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());
  const currentQuiz = quiz?.find((q) => !answeredIds.has(q.id));
  // Reveal "Bạn có biết…" sau khi trả lời, trước khi sang câu kế.
  const [reveal, setReveal] = useState<QuizReveal | null>(null);

  const { checkInM, dewM, freezeM, repairM, handleSpin, waterM, buyTreeM, claimMissionM, answerM } = useGameActions({
    notify,
    onHarvest: () => notify('Cây đã thu hoạch! 🎉', 'success'),
    onAnswered: (r: AnswerResult, vars) => setReveal({ ...r, quizId: vars.id, choice: vars.choice }),
  });
  const wheelPrize = useWheelPrize();
  const nextQuiz = () => {
    if (reveal) setAnsweredIds((prev) => new Set(prev).add(reveal.quizId));
    setReveal(null);
  };

  if (isLoading) return <GameSkeleton />;
  // Hồ sơ là dữ liệu chủ đạo của trang (chuỗi/giọt nước/tác động xanh): lỗi thì báo rõ, không dựng với số 0 trông như "mất hết tiến độ".
  if (isError && !profile) return <ErrorState message={errText(profileError)} onRetry={() => void refetch()} />;

  const eco = profile?.ecoImpact;
  const wasteLink = publicConfig.waste.enabled && isWebRouteReady(WASTE_PATH);

  return (
    <>
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        <GardenHero eco={eco} totalSeeds={profile?.totalSeeds} streakDays={profile?.streakDays} />

        {/* Dính đầu trang để thanh tab còn trong tầm tay khi cuộn hết khối dài của "Hôm nay". */}
        <div className="sticky top-0 z-10 bg-stone-25 py-1">
          <SegmentedTabs items={GAME_TABS.map((t) => ({ key: t.key, label: t.label }))} value={tab} onChange={setTab} label="Vườn Xanh" />
        </div>

        <GameTabPanel tab="today" active={tab === ('today' satisfies GameTabKey)}>
          <TreeHealthAlert health={profile?.treeHealth} />

          {/* Hồi sinh chuỗi vừa mất (§streak-repair) — chỉ hiện trong cửa sổ hồi sinh */}
          {profile?.streakRepairable && (
            <StreakRepair brokenStreakDays={profile.brokenStreakDays} cost={profile.streakRepairCost} pending={repairM.isPending} onRepair={() => repairM.mutate()} />
          )}

          <TreeActions
            treePointsPrice={profile?.treePointsPrice}
            waterPending={waterM.isPending}
            onWater={() => waterM.mutate()}
            buyPending={buyTreeM.isPending}
            onBuy={(idempotencyKey) => buyTreeM.mutateAsync(idempotencyKey).then(() => true, () => false)}
          />

          <CheckInStreak
            profile={profile}
            onCheckIn={() => checkInM.mutate()}
            checkInPending={checkInM.isPending}
            onBuyFreeze={() => freezeM.mutate()}
            freezePending={freezeM.isPending}
            onCollectDew={() => dewM.mutate()}
            dewPending={dewM.isPending}
          />

          <MissionsCard
            missions={missions}
            streakDays={profile?.streakDays}
            claimPending={claimMissionM.isPending}
            claimVariables={claimMissionM.variables}
            onClaim={(code) => claimMissionM.mutate(code)}
          />

          <QuizCard
            quiz={quiz}
            currentQuiz={currentQuiz}
            answeredCount={answeredIds.size}
            reveal={reveal}
            pending={answerM.isPending}
            onAnswer={(id, choice) => answerM.mutate({ id, choice })}
            onNext={nextQuiz}
          />

          <LuckyWheelCard cost={profile?.spinCostPoints ?? 10} onSpin={handleSpin} onResult={wheelPrize.onResult} />

          {/* Lối vào Đổi rác lấy quà (spec 4.9): chỉ khi chương trình bật và trang đổi rác đã có trên web */}
          {wasteLink && (
            <GameLinkRow icon={Recycle} title="Đổi rác lấy quà" badge="Mới" hint="Giọt nước dùng trong Vườn, Điểm Xanh dùng để mua sắm" href={WASTE_PATH} />
          )}
        </GameTabPanel>

        <GameTabPanel tab="garden" active={tab === 'garden'}>
          {/* Tác động xanh (§6.7.7 — phần khả thi từ treesPlanted) */}
          <EcoImpact eco={eco} totalSeeds={profile?.totalSeeds} forest={forest} />
        </GameTabPanel>

        <GameTabPanel tab="community" active={tab === 'community'}>
          {/* Banner mùa/sự kiện (Phase 4) */}
          {season && <SeasonBanner season={season} />}
        </GameTabPanel>
      </div>

      {/* Hộp kết quả vòng quay: ngoài khối tab để vẫn hiện khi khách đã đổi tab trong lúc quay. */}
      <WheelPrizeSheet {...wheelPrize.sheet} onUseCoupon={() => router.push('/san-pham')} />
      <GameNoticeBar notice={notice} />
    </>
  );
}

export default function GamePage() {
  const phase = useAuthPhase();
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 pb-24">
      <PageHeader title={TITLE} />
      <div className="mt-4">
        {phase === 'loading' && <AuthLoading />}
        {phase === 'unavailable' && <SessionUnavailable />}
        {phase === 'guest' && <GameLoginGate returnTo="/vuon-xanh" />}
        {phase === 'authenticated' && (
          <Suspense fallback={<GameSkeleton />}>
            <GameBody />
          </Suspense>
        )}
      </div>
    </main>
  );
}
