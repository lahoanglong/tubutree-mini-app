'use client';

import { Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { MessagesSquare, Recycle } from 'lucide-react';
import { SEASON_PASS_ENABLED } from '@tubutree/app-core/features';
import { GAME_CHECKIN_ANCHOR, extraPlotsVisible, gameNewbieCopy, type MissionTarget, type PrimaryWaterAction } from '@tubutree/app-core/game-newbie';
import { checkInQuery, loyaltyQuery } from '@tubutree/app-core/queries/loyalty';
import type { AnswerResult, HarvestSpecies } from '@tubutree/app-core/api/game';
import { useAuthPhase } from '@/lib/auth-phase';
import { loginHref } from '@/lib/return-to';
import { coreHttp } from '@/lib/core-http';
import { pointsSummary } from '@/lib/checkout-points';
import { dismissGameTutorial, isGameTutorialDismissed } from '@/lib/game-tutorial';
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
import { GAME_TAB_KEYS, GAME_COL, GAME_TABS, GameCol, GameTabPanel, type GameTabKey } from '@/components/game/game-tabs';
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
import { TreeFund } from '@/components/game/tree-fund';
import { EarnWaterSheet, type EarnQuizState } from '@/components/game/earn-water-sheet';
import { NewbieGuide } from '@/components/game/newbie-guide';
import { isSameVNDay } from '@/components/game/game-utils';
import { TreeHealthAlert } from '@/components/game/tree-health-alert';
import { useGameActions, type HarvestMeta, type HarvestReward } from '@/components/game/use-game-actions';
import { useGameData } from '@/components/game/use-game-data';
import { useHeaderOffset } from '@/components/game/use-header-offset';
import { useWheelPrize } from '@/components/game/use-wheel-prize';
import { WeeklyLeaderboard } from '@/components/game/weekly-leaderboard';
import { WheelPrizeSheet } from '@/components/game/wheel-prize-sheet';
import { PAGE_WIDE } from '@/lib/page-frame';
import { loadErrorText } from '@/lib/error-text';

const TITLE = 'Vườn Xanh';
const WASTE_PATH = '/doi-rac';
const FEED_PATH = '/cong-dong';
const POINTS_PATH = '/tai-khoan/diem-xanh';
const MISSION_PATHS: Record<Exclude<MissionTarget, 'checkin'>, string> = {
  catalog: '/san-pham',
  'delivered-orders': '/tai-khoan/don-hang?tab=delivered',
  invite: '/tai-khoan/vi-tubu',
};

const errText = loadErrorText;

function GameBody() {
  const router = useRouter();
  const publicConfig = usePublicConfig();
  const { notice, notify } = useGameNotice();
  const headerOffset = useHeaderOffset();
  const [tab, setTab] = useTabParam(GAME_TAB_KEYS, 'today');
  const { profileQ, quizQ, quiz, board, missions, forest, community, codex, season, seasonBoard, friends, garden, seasonPass } = useGameData(true);
  const { data: profile, isLoading, isError, error: profileError, refetch } = profileQ;

  // Quiz nhiều câu/ngày: theo dõi câu đã trả lời phía trình duyệt để hiện câu kế tiếp (§6.7.8).
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());
  const currentQuiz = quiz?.find((q) => !answeredIds.has(q.id));
  // Reveal "Bạn có biết…" sau khi trả lời, trước khi sang câu kế.
  const [reveal, setReveal] = useState<QuizReveal | null>(null);

  const [harvest, setHarvest] = useState<{ open: boolean; reward: HarvestReward | undefined; meta: HarvestMeta | null; shared: boolean }>({ open: false, reward: undefined, meta: null, shared: false });
  // Sheet "Kiếm nước": đích chung của mọi nút thiếu nước. `missing` = số giọt thiếu của nút đã mở nó (null: nút chính).
  const [earn, setEarn] = useState<{ open: boolean; missing: number | null }>({ open: false, missing: null });
  const [tutorialDismissed, setTutorialDismissed] = useState(() => isGameTutorialDismissed());
  const { data: loyalty } = useQuery(loyaltyQuery(coreHttp));
  // Nút điểm danh của Vườn theo trạng thái GỘP (Điểm Xanh + giọt nước): còn bấm được tới khi cả hai phần xong, để lần lỗi một phần bấm lại được.
  const checkInStatusQ = useQuery(checkInQuery(coreHttp));
  // Điểm dùng được: vòng quay chỉ trừ điểm thường chưa khoá, góp quỹ trừ thêm cả điểm quy đổi. Chưa tải được thì null để
  // nút vẫn bấm được (API là lưới an toàn).
  const wheelPoints = loyalty ? (loyalty.redeemablePoints ?? pointsSummary(loyalty).standard) : null;
  const fundPoints = loyalty ? (loyalty.redeemableTotal ?? pointsSummary(loyalty).total) : null;

  const { checkInM, dewM, freezeM, repairM, giftM, handleSpin, waterM, buyTreeM, unlockM, waterPlotM, claimPassM, claimMissionM, answerM, shareHarvestM } = useGameActions({
    notify,
    onHarvest: (reward, meta) => setHarvest({ open: true, reward, meta, shared: false }),
    onAnswered: (r: AnswerResult, vars) => setReveal({ ...r, quizId: vars.id, choice: vars.choice }),
  });
  const wheelPrize = useWheelPrize();
  const openEarn = (missing: number | null = null) => setEarn({ open: true, missing });
  const closeEarn = () => setEarn((e) => ({ ...e, open: false }));
  const goTab = (key: GameTabKey, scrollToId?: string) => {
    closeEarn();
    setTab(key);
    if (scrollToId) setTimeout(() => document.getElementById(scrollToId)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 60);
  };
  const claimDaily = (action: Extract<PrimaryWaterAction, { kind: 'claim' }>) =>
    checkInM.mutate(undefined, { onSuccess: () => action.withDew && dewM.mutate() });
  const goMission = (target: MissionTarget) => {
    if (target === 'checkin') goTab('today', GAME_CHECKIN_ANCHOR);
    else router.push(MISSION_PATHS[target]);
  };
  const shareToCommunity = () =>
    shareHarvestM.mutate(undefined, { onSuccess: () => setHarvest((h) => ({ ...h, shared: true })) });
  const nextQuiz = () => {
    if (reveal) setAnsweredIds((prev) => new Set(prev).add(reveal.quizId));
    setReveal(null);
  };

  if (isLoading) return <GameSkeleton />;
  // Hồ sơ là dữ liệu chủ đạo của trang (chuỗi/giọt nước/tác động xanh): lỗi thì báo rõ, không dựng với số 0 trông như "mất hết tiến độ".
  if (isError && !profile) return <ErrorState message={errText(profileError)} onRetry={() => void refetch()} />;

  const eco = profile?.ecoImpact;
  const checkedInToday = isSameVNDay(profile?.lastCheckInAt ?? null);
  // Gộp điểm + nước: tải lỗi thì để nút bật (POST idempotent, đã xong sẽ báo "đã điểm danh rồi"), đừng suy từ lastCheckInAt vì nó chỉ là phần nước.
  const checkInDone = checkInStatusQ.data ? checkInStatusQ.data.checkedInToday : checkInStatusQ.isError ? false : checkedInToday;
  const dewToday = isSameVNDay(profile?.lastDewAt ?? null);
  const dailyGain = profile?.dailyLoginSeeds != null ? profile.dailyLoginSeeds + (profile.firstCheckinBonus ?? 0) : null;
  const tomorrowGain = profile?.dailyLoginSeeds != null && profile.dewSeeds != null ? profile.dailyLoginSeeds + profile.dewSeeds : null;
  const quizState: EarnQuizState = quiz
    ? { status: 'ready', left: quiz.filter((q) => !answeredIds.has(q.id)).length }
    : quizQ.isError
      ? { status: 'error' }
      : { status: 'loading' };
  const quizTotal = quiz ? quiz.reduce((sum, q) => sum + (q.waterReward ?? 0), 0) : null;
  const earnError = checkInM.isError ? errText(checkInM.error) : dewM.isError ? errText(dewM.error) : null;
  const plotsOpen = garden ? extraPlotsVisible(eco?.treesPlanted, garden.plots.some((p) => !p.isHome)) : false;
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
      <div className="flex flex-col gap-3">
        <GardenHero eco={eco} totalSeeds={profile?.totalSeeds} streakDays={profile?.streakDays} />

        {/* Dính dưới thanh đầu trang của site để thanh tab còn trong tầm tay khi cuộn hết khối dài của "Hôm nay". */}
        <div className="sticky-below-back sticky z-10 bg-stone-25 py-1" style={{ top: headerOffset }}>
          <SegmentedTabs items={GAME_TABS.map((t) => ({ key: t.key, label: t.label }))} value={tab} onChange={setTab} label="Vườn Xanh" />
        </div>

        <GameTabPanel tab="today" active={tab === ('today' satisfies GameTabKey)} layout="split">
          <GameCol place={GAME_COL.top}>
          <TreeHealthAlert health={profile?.treeHealth} />

          {/* Hồi sinh chuỗi vừa mất (§streak-repair) — chỉ hiện trong cửa sổ hồi sinh */}
          {profile?.streakRepairable && (
            <StreakRepair brokenStreakDays={profile.brokenStreakDays} cost={profile.streakRepairCost}
              totalSeeds={profile.totalSeeds}
              pending={repairM.isPending}
              onRepair={() => repairM.mutate()}
              onNeedWater={openEarn}
            />
          )}

          <NewbieGuide
            profile={profile}
            dismissed={tutorialDismissed}
            quizTotal={quizTotal}
            tomorrowGain={tomorrowGain}
            onDismiss={() => {
              dismissGameTutorial();
              setTutorialDismissed(true);
            }}
          />

          <TreeActions
            profile={profile}
            pending={waterM.isPending || checkInM.isPending || dewM.isPending}
            onClaim={claimDaily}
            onWater={(drops) => waterM.mutate(drops)}
            onEarn={() => openEarn()}
          />
          </GameCol>

          <GameCol place={GAME_COL.side}>
          <div id={GAME_CHECKIN_ANCHOR}>
          <CheckInStreak
            profile={profile}
            allDone={checkInDone}
            onCheckIn={() => checkInM.mutate()}
            checkInPending={checkInM.isPending}
            onBuyFreeze={() => freezeM.mutate()}
            freezePending={freezeM.isPending}
            onCollectDew={() => dewM.mutate()}
            dewPending={dewM.isPending}
            onNeedWater={openEarn}
          />
          </div>

          <div className="empty:hidden">
          <MissionsCard
            missions={missions}
            streakDays={profile?.streakDays}
            claimPending={claimMissionM.isPending}
            claimVariables={claimMissionM.variables}
            onClaim={(code) => claimMissionM.mutate(code)}
            onGo={goMission}
          />
          </div>
          </GameCol>

          <GameCol place={GAME_COL.bottom}>
          <div id="game-quiz">
            <QuizCard
              quiz={quiz}
              currentQuiz={currentQuiz}
              answeredCount={answeredIds.size}
              reveal={reveal}
              pending={answerM.isPending}
              onAnswer={(id, choice) => answerM.mutate({ id, choice })}
              onNext={nextQuiz}
            />
          </div>

          <div>
          <LuckyWheelCard
            cost={profile?.spinCostPoints ?? 10_000}
            points={wheelPoints}
            onEarnPoints={() => router.push(POINTS_PATH)}
            onSpin={handleSpin}
            onResult={wheelPrize.onResult}
          />
          </div>

          {/* Lối vào Đổi rác lấy quà (spec 4.9): chỉ khi chương trình bật và trang đổi rác đã có trên web */}
          {wasteLink && (
            <div>
              <GameLinkRow icon={Recycle} title="Đổi rác lấy quà" badge="Mới" hint="Giọt nước dùng trong Vườn, Điểm Xanh dùng để mua sắm" href={WASTE_PATH} />
            </div>
          )}
          </GameCol>
        </GameTabPanel>

        <GameTabPanel tab="garden" active={tab === 'garden'}>
          {/* Lô đất / mở rộng vườn (§6.7) — nhiều cây song song */}
          {garden && plotsOpen && (
            <GardenPlots
              garden={garden}
              totalSeeds={profile?.totalSeeds ?? 0}
              onNeedWater={openEarn}
              waterPlotPending={waterPlotM.isPending}
              waterPlotVariables={waterPlotM.variables}
              onWaterPlot={(plotId) => waterPlotM.mutate(plotId)}
              unlockPending={unlockM.isPending}
              onUnlock={(slot) => unlockM.mutate(slot)}
            />
          )}

          {garden && !plotsOpen && <p className="text-xs text-stone-700">{gameNewbieCopy.plots.locked}</p>}

          {/* Sổ tay loài cây (Phase 3) — sưu tập khi thu hoạch */}
          {codex && codex.length > 0 && <SpeciesCodex codex={codex} />}

          {/* Tác động xanh (§6.7.7 — phần khả thi từ treesPlanted) */}
          <EcoImpact eco={eco} totalSeeds={profile?.totalSeeds} forest={forest} />

          <TreeFund
            treePointsPrice={profile?.treePointsPrice}
            points={fundPoints}
            onEarnPoints={() => router.push(POINTS_PATH)}
            buyPending={buyTreeM.isPending}
            onBuy={(idempotencyKey) => buyTreeM.mutateAsync(idempotencyKey).then(() => true, () => false)}
          />

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

      <EarnWaterSheet
        open={earn.open}
        onClose={closeEarn}
        totalSeeds={profile?.totalSeeds ?? 0}
        missing={earn.missing}
        checkedInToday={checkedInToday}
        dewToday={dewToday}
        checkInGain={dailyGain}
        dewGain={profile?.dewSeeds ?? null}
        checkInPending={checkInM.isPending}
        dewPending={dewM.isPending}
        onCheckIn={() => checkInM.mutate()}
        onDew={() => dewM.mutate()}
        quiz={quizState}
        onRetryQuiz={() => void quizQ.refetch()}
        onGoQuiz={() => goTab('today', 'game-quiz')}
        hasFriends={(friends?.length ?? 0) > 0}
        onGoFriends={() => goTab('community')}
        error={earnError}
      />

      <HarvestCelebration
        open={harvest.open}
        coupons={harvest.meta?.coupons ?? []}
        guest={harvest.meta?.guest ?? false}
        onLogin={() => {
          closeHarvest();
          router.push(loginHref('/vuon-xanh'));
        }}
        points={harvest.reward?.points ?? null}
        sprout={harvest.meta?.sprout ?? false}
        canShare={harvest.meta?.canShare ?? true}
        couponCapped={harvest.meta?.couponCapped ?? null}
        nextTarget={harvest.meta?.nextTarget ?? null}
        certificate={harvest.reward?.certificate ?? null}
        species={harvestSpecies}
        onClose={closeHarvest}
        shared={harvest.shared}
        sharing={shareHarvestM.isPending}
        onShare={shareToCommunity}
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
    <main className={`${PAGE_WIDE} py-6 pb-24 max-md:pt-0`}>
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
