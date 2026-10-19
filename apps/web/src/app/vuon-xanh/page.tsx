'use client';

import { Suspense, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessagesSquare, Recycle } from 'lucide-react';
import { SEASON_PASS_ENABLED } from '@tubutree/app-core/features';
import type { AnswerResult, HarvestSpecies } from '@tubutree/app-core/api/game';
import { useAuthPhase } from '@/lib/auth-phase';
import { isWebRouteReady } from '@/lib/route-map';
import { usePublicConfig } from '@/lib/use-public-config';
import { AuthLoading, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedTabs, useTabParam } from '@/components/ui/segmented-tabs';
import { CheckInStreak } from '@/components/game/checkin-streak';
import { CommunityGoal } from '@/components/game/community-goal';
import { EcoImpact } from '@/components/game/eco-impact';
import { FriendGifts } from '@/components/game/friend-gifts';
import { GardenPlots } from '@/components/game/garden-plots';
import { GameLinkRow } from '@/components/game/game-link-row';
import { GameNoticeBar, useGameNotice } from '@/components/game/game-notice';
import { GameLoginGate, GameSkeleton } from '@/components/game/game-states';
import { GAME_TAB_KEYS, GAME_TABS, GameTabPanel, type GameTabKey } from '@/components/game/game-tabs';
import { GardenHero } from '@/components/game/garden-hero';
import { HarvestCelebration } from '@/components/game/harvest-celebration';
import { LuckyWheelCard } from '@/components/game/lucky-wheel-card';
import { MissionsCard } from '@/components/game/missions-card';
import { QuizCard, type QuizReveal } from '@/components/game/quiz-card';
import { SeasonBanner } from '@/components/game/season-banner';
import { SeasonLeaderboard } from '@/components/game/season-leaderboard';
import { SeasonPass } from '@/components/game/season-pass';
import { SpeciesCodex } from '@/components/game/species-codex';
import { StreakRepair } from '@/components/game/streak-repair';
import { TreeActions } from '@/components/game/tree-actions';
import { TreeHealthAlert } from '@/components/game/tree-health-alert';
import { useGameActions, type HarvestReward } from '@/components/game/use-game-actions';
import { useGameData } from '@/components/game/use-game-data';
import { useHeaderOffset } from '@/components/game/use-header-offset';
import { useWheelPrize } from '@/components/game/use-wheel-prize';
import { WeeklyLeaderboard } from '@/components/game/weekly-leaderboard';
import { WheelPrizeSheet } from '@/components/game/wheel-prize-sheet';

const TITLE = 'Vườn Xanh';
const WASTE_PATH = '/doi-rac';
const FEED_PATH = '/cong-dong';

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');

function GameBody() {
  const router = useRouter();
  const publicConfig = usePublicConfig();
  const { notice, notify } = useGameNotice();
  const headerOffset = useHeaderOffset();
  const [tab, setTab] = useTabParam(GAME_TAB_KEYS, 'today');
  const { profileQ, quiz, board, missions, forest, community, codex, season, seasonBoard, friends, garden, seasonPass } = useGameData(true);
  const { data: profile, isLoading, isError, error: profileError, refetch } = profileQ;

  // Quiz nhiều câu/ngày: theo dõi câu đã trả lời phía trình duyệt để hiện câu kế tiếp (§6.7.8).
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());
  const currentQuiz = quiz?.find((q) => !answeredIds.has(q.id));
  // Reveal "Bạn có biết…" sau khi trả lời, trước khi sang câu kế.
  const [reveal, setReveal] = useState<QuizReveal | null>(null);

  const [harvest, setHarvest] = useState<{ open: boolean; reward: HarvestReward | undefined }>({ open: false, reward: undefined });

  const { checkInM, dewM, freezeM, repairM, giftM, handleSpin, waterM, buyTreeM, unlockM, waterPlotM, claimPassM, claimMissionM, answerM } = useGameActions({
    notify,
    onHarvest: (reward) => setHarvest({ open: true, reward }),
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
  const feedLink = isWebRouteReady(FEED_PATH);
  const harvestSpecies: HarvestSpecies | null = harvest.reward?.species ?? null;
  const closeHarvest = () => setHarvest((h) => ({ ...h, open: false }));
  // navigator.clipboard không có ở ngữ cảnh không bảo mật và vài WebView: ném đồng bộ, nên bọc try/catch chứ không chỉ .catch.
  const copyCoupon = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      notify('Đã sao chép mã giảm giá', 'success');
    } catch {
      notify(`Không sao chép được — mã của bạn: ${code}`, 'error');
    }
  };

  return (
    <>
      <div className="mx-auto flex max-w-2xl flex-col gap-3 lg:max-w-5xl">
        <GardenHero eco={eco} totalSeeds={profile?.totalSeeds} streakDays={profile?.streakDays} />

        {/* Dính dưới thanh đầu trang của site để thanh tab còn trong tầm tay khi cuộn hết khối dài của "Hôm nay". */}
        <div className="sticky z-10 bg-stone-25 py-1" style={{ top: headerOffset }}>
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

          <LuckyWheelCard cost={profile?.spinCostPoints ?? 10_000} onSpin={handleSpin} onResult={wheelPrize.onResult} />

          {/* Lối vào Đổi rác lấy quà (spec 4.9): chỉ khi chương trình bật và trang đổi rác đã có trên web */}
          {wasteLink && (
            <GameLinkRow icon={Recycle} title="Đổi rác lấy quà" badge="Mới" hint="Giọt nước dùng trong Vườn, Điểm Xanh dùng để mua sắm" href={WASTE_PATH} />
          )}
        </GameTabPanel>

        <GameTabPanel tab="garden" active={tab === 'garden'}>
          {/* Lô đất / mở rộng vườn (§6.7) — nhiều cây song song */}
          {garden && (
            <GardenPlots
              garden={garden}
              waterPlotPending={waterPlotM.isPending}
              waterPlotVariables={waterPlotM.variables}
              onWaterPlot={(plotId) => waterPlotM.mutate(plotId)}
              unlockPending={unlockM.isPending}
              onUnlock={(slot) => unlockM.mutate(slot)}
            />
          )}

          {/* Sổ tay loài cây (Phase 3) — sưu tập khi thu hoạch */}
          {codex && codex.length > 0 && <SpeciesCodex codex={codex} />}

          {/* Tác động xanh (§6.7.7 — phần khả thi từ treesPlanted) */}
          <EcoImpact eco={eco} totalSeeds={profile?.totalSeeds} forest={forest} />

          {/* Mốc cộng đồng góp quỹ trồng cây (Phase 2) — hồ giọt nước toàn cộng đồng */}
          {community?.goal && <CommunityGoal goal={community.goal} myDrops={community.myDrops} pct={community.pct} />}
        </GameTabPanel>

        <GameTabPanel tab="community" active={tab === 'community'}>
          {/* Banner mùa/sự kiện (Phase 4) */}
          {season && <SeasonBanner season={season} />}

          {/* Chặng Mùa (Season Pass) — ladder bậc XP theo điểm danh */}
          {SEASON_PASS_ENABLED && seasonPass?.active && seasonPass.tiers && seasonPass.tiers.length > 0 && (
            <SeasonPass
              pass={seasonPass}
              claimPending={claimPassM.isPending}
              claimVariables={claimPassM.variables}
              onClaim={(tier, track) => claimPassM.mutate({ tier, track })}
            />
          )}

          {/* Tặng nước bạn bè (social) */}
          {friends && friends.length > 0 && (
            <FriendGifts friends={friends} giftPending={giftM.isPending} giftVariables={giftM.variables} onGift={(recipientId) => giftM.mutate(recipientId)} />
          )}

          <WeeklyLeaderboard board={board} />

          {seasonBoard && seasonBoard.length > 0 && <SeasonLeaderboard rows={seasonBoard} />}

          {/* Bảng tin cộng đồng (§6.14.12): chỉ khi trang đã có trên web */}
          {feedLink && <GameLinkRow icon={MessagesSquare} title="Bảng tin cộng đồng" hint="Khoe thành tích xanh & cổ vũ nhau trồng cây" href={FEED_PATH} />}
        </GameTabPanel>
      </div>

      {/* Hộp kết quả vòng quay: ngoài khối tab để vẫn hiện khi khách đã đổi tab trong lúc quay. */}
      <WheelPrizeSheet {...wheelPrize.sheet} onUseCoupon={() => router.push('/san-pham')} />

      <HarvestCelebration
        open={harvest.open}
        coupon={harvest.reward?.coupon ?? null}
        certificate={harvest.reward?.certificate ?? null}
        species={harvestSpecies}
        onClose={closeHarvest}
        onCopyCoupon={(code) => void copyCoupon(code)}
        onUseCoupon={() => {
          closeHarvest();
          router.push('/san-pham');
        }}
      />
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
