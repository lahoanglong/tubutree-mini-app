import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GAME_CHECKIN_ANCHOR, extraPlotsVisible, type MissionTarget, type PrimaryWaterAction } from '@tubutree/app-core/game-newbie';
import { Page, useNavigate } from 'zmp-ui';
import type { HarvestSpecies } from '../services/game-api';
import { useAuthStore } from '../store/auth';
import { SessionUnavailable } from '../components/ui/auth-gate';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { usePublicConfig } from '../hooks/use-public-config';
import { ErrorState } from '../components/ui/empty-state';
import { PageHeader } from '../components/ui/page-header';
import { SegmentedTabs } from '../components/ui/segmented-tabs';
import { getErrorMessage } from '../services/api';
import { getLoyalty } from '../services/account-api';
import { shareLink } from '../services/zmp-bridge';
import { pointsSummary } from '../utils/points-lots';
import { dismissGameTutorial, isGameTutorialDismissed } from '../utils/game-tutorial';
import { MessagesSquare, Recycle } from 'lucide-react';
import { vi } from '../i18n/vi';
import { Text } from '../components/ui/text';
import { GameLoginGate, GameSkeleton } from '../components/game/game-states';
import { GardenHero } from '../components/game/garden-hero';
import { GameLinkRow } from '../components/game/game-link-row';
import { SeasonBanner } from '../components/game/season-banner';
import { TreeHealthAlert } from '../components/game/tree-health-alert';
import { CheckInStreak } from '../components/game/checkin-streak';
import { StreakRepair } from '../components/game/streak-repair';
import { TreeActions } from '../components/game/tree-actions';
import { TreeFund } from '../components/game/tree-fund';
import { EarnWaterSheet, type EarnQuizState } from '../components/game/earn-water-sheet';
import { NewbieGuide } from '../components/game/newbie-guide';
import { isSameVNDay } from '../components/game/game-utils';
import { GardenPlots } from '../components/game/garden-plots';
import { SeasonPass } from '../components/game/season-pass';
import { CommunityGoal } from '../components/game/community-goal';
import { SpeciesCodex } from '../components/game/species-codex';
import { FriendGifts } from '../components/game/friend-gifts';
import { EcoImpact } from '../components/game/eco-impact';
import { LuckyWheelCard } from '../components/game/lucky-wheel-card';
import { QuizCard, type QuizReveal } from '../components/game/quiz-card';
import { MissionsCard } from '../components/game/missions-card';
import { SeasonLeaderboard } from '../components/game/season-leaderboard';
import { WeeklyLeaderboard } from '../components/game/weekly-leaderboard';
import { HarvestCelebration } from '../components/game/harvest-celebration';
import { WheelPrizeSheet } from '../components/game/wheel-prize-sheet';
import { GAME_TABS, GameTabPanel, type GameTabKey } from '../components/game/game-tabs';
import { useGameData } from '../components/game/use-game-data';
import { useWheelPrize } from '../components/game/use-wheel-prize';
import { useGameActions, type HarvestMeta, type HarvestReward } from '../components/game/use-game-actions';
import { SEASON_PASS_ENABLED } from '../utils/features';

const MISSION_PATHS: Record<Exclude<MissionTarget, 'checkin'>, string> = {
  catalog: '/browse',
  'delivered-orders': '/orders?tab=delivered',
  invite: '/wallet',
};

export default function GamePage() {
  const phase = useAuthPhase();
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const publicConfig = usePublicConfig();
  const authed = phase === 'authenticated';

  const { profileQ, quizQ, quiz, board, missions, forest, community, codex, season, seasonBoard, friends, garden, seasonPass } =
    useGameData(authed);
  const { data: profile, isLoading, isError, error: profileError, refetch } = profileQ;

  // Quiz nhiều câu/ngày: theo dõi câu đã trả lời client-side để hiện câu kế tiếp (§6.7.8).
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());
  const currentQuiz = quiz?.find((q) => !answeredIds.has(q.id));
  // Reveal "Bạn có biết…" sau khi trả lời, trước khi sang câu kế.
  const [reveal, setReveal] = useState<QuizReveal | null>(null);
  const [tab, setTab] = useState<GameTabKey>('today');
  const [harvested, setHarvested] = useState(false);
  const [harvestCoupons, setHarvestCoupons] = useState<string[]>([]);
  const [harvestCert, setHarvestCert] = useState<string | null>(null);
  const [harvestSpecies, setHarvestSpecies] = useState<HarvestSpecies | null>(null);
  const [harvestPoints, setHarvestPoints] = useState<number | null>(null);
  const [harvestMeta, setHarvestMeta] = useState<HarvestMeta | null>(null);
  // Sheet "Kiếm nước": đích chung của mọi nút thiếu nước. `missing` = số giọt thiếu của nút đã mở nó (null: nút chính).
  const [earn, setEarn] = useState<{ open: boolean; missing: number | null }>({ open: false, missing: null });
  const [tutorialDismissed, setTutorialDismissed] = useState(() => isGameTutorialDismissed());
  const loyaltyQ = useQuery({ queryKey: ['loyalty'], queryFn: getLoyalty, enabled: authed });
  // Điểm dùng được: vòng quay chỉ trừ điểm thường chưa khoá, góp quỹ trừ thêm cả điểm quy đổi. Chưa tải được thì null
  // để nút vẫn bấm được (API là lưới an toàn).
  const loyalty = loyaltyQ.data;
  const wheelPoints = loyalty ? (loyalty.redeemablePoints ?? pointsSummary(loyalty).standard) : null;
  const fundPoints = loyalty ? (loyalty.redeemableTotal ?? pointsSummary(loyalty).total) : null;

  const { checkInM, dewM, freezeM, repairM, giftM, handleSpin, waterM, buyTreeM, unlockM, waterPlotM, claimPassM, claimMissionM, answerM } =
    useGameActions({
      onHarvest: (reward: HarvestReward | undefined, meta: HarvestMeta) => {
        setHarvestCoupons(meta.coupons);
        setHarvestCert(reward?.certificate ?? null);
        setHarvestSpecies(reward?.species ?? null);
        setHarvestPoints(reward?.points ?? null);
        setHarvestMeta(meta);
        setHarvested(true); // mở modal celebration
      },
      onAnswered: (r, vars) => setReveal({ ...r, quizId: vars.id, choice: vars.choice }),
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
    else navigate(MISSION_PATHS[target]);
  };
  const shareHarvest = () => {
    const t = vi.game.newbie.harvest;
    void shareLink({ title: t.shareTitle, description: t.shareDescription, path: '/game' }).catch(() => undefined);
  };
  const nextQuiz = () => {
    if (reveal) setAnsweredIds((prev) => new Set(prev).add(reveal.quizId));
    setReveal(null);
  };

  // Đang silent-login lúc mở app (restore chưa xong) → skeleton thay vì chớp cổng đăng nhập.
  const shell = (children: ReactNode) => (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 'calc(76px + var(--safe-bottom))' }}>
      <PageHeader title="Vườn Xanh" back={false} />
      {children}
    </Page>
  );
  if (phase === 'loading' || (authed && isLoading)) return shell(<GameSkeleton />);

  // Mất kết nối lúc khôi phục phiên: không phải khách — nói đúng vậy + Thử lại, không mời đăng nhập lại.
  if (phase === 'unavailable') return shell(<SessionUnavailable />);

  // Chỉ hiện cổng đăng nhập khi đã chắc chắn user chưa đăng nhập (status settled, không authenticated)
  // — trước đây gộp chung với nhánh loading khiến user đã logout/login lỗi bị kẹt mãi ở skeleton.
  if (!authed) return shell(<GameLoginGate onLogin={() => void login()} />);

  // Profile là dữ liệu chủ đạo của trang (streak/giọt nước/eco-impact) — lỗi thì phải báo rõ,
  // không để rơi xuống render với optional-chaining trông như "mất hết tiến độ".
  if (isError && !profile) return shell(<ErrorState message={getErrorMessage(profileError)} onRetry={() => void refetch()} />);

  const eco = profile?.ecoImpact;
  const checkedInToday = isSameVNDay(profile?.lastCheckInAt ?? null);
  const dewToday = isSameVNDay(profile?.lastDewAt ?? null);
  const dailyGain = profile?.dailyLoginSeeds != null ? profile.dailyLoginSeeds + (profile.firstCheckinBonus ?? 0) : null;
  const tomorrowGain = profile?.dailyLoginSeeds != null && profile.dewSeeds != null ? profile.dailyLoginSeeds + profile.dewSeeds : null;
  const quizState: EarnQuizState = quiz
    ? { status: 'ready', left: quiz.filter((q) => !answeredIds.has(q.id)).length }
    : quizQ.isError
      ? { status: 'error' }
      : { status: 'loading' };
  const quizTotal = quiz ? quiz.reduce((sum, q) => sum + (q.waterReward ?? 0), 0) : null;
  const earnError = checkInM.isError ? getErrorMessage(checkInM.error) : dewM.isError ? getErrorMessage(dewM.error) : null;
  const plotsOpen = garden ? extraPlotsVisible(eco?.treesPlanted, garden.plots.some((p) => !p.isHome)) : false;

  return shell(
    <>
      <div style={{ padding: '12px 16px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <GardenHero eco={eco} totalSeeds={profile?.totalSeeds} streakDays={profile?.streakDays} />

        {/* Điều hướng nội bộ: giữ thanh tab trong tầm tay khi cuộn hết khối dài của "Hôm nay".
            top = safe-top vì app immersive: dính mép 0 thì tab "Cộng đồng" nằm dưới status bar/capsule Zalo. */}
        <div style={{ position: 'sticky', top: 'var(--safe-top)', zIndex: 5, background: 'var(--color-bg-canvas)', padding: '4px 0' }}>
          <SegmentedTabs items={GAME_TABS.map((t) => ({ key: t.key, label: t.label }))} value={tab} onChange={(key) => setTab(key as GameTabKey)} />
        </div>

        {/* Hôm nay: hành động chính của ngày nằm trong hai màn hình đầu (tưới, điểm danh, nhiệm vụ). */}
        <GameTabPanel tab="today" active={tab === 'today'}>
          <TreeHealthAlert health={profile?.treeHealth} />

          {/* Hồi sinh chuỗi vừa mất (§streak-repair) — chỉ hiện trong cửa sổ hồi sinh */}
          {profile?.streakRepairable && (
            <StreakRepair
              brokenStreakDays={profile.brokenStreakDays}
              cost={profile.streakRepairCost}
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

          {/* Điểm danh — chuỗi 7 ngày (§6.7.2) */}
          <div id={GAME_CHECKIN_ANCHOR}>
          <CheckInStreak
            profile={profile}
            onCheckIn={() => checkInM.mutate()}
            checkInPending={checkInM.isPending}
            onBuyFreeze={() => freezeM.mutate()}
            freezePending={freezeM.isPending}
            onCollectDew={() => dewM.mutate()}
            dewPending={dewM.isPending}
            onNeedWater={openEarn}
          />
          </div>

          <MissionsCard
            missions={missions}
            streakDays={profile?.streakDays}
            claimPending={claimMissionM.isPending}
            claimVariables={claimMissionM.variables}
            onClaim={(code) => claimMissionM.mutate(code)}
            onGo={goMission}
          />

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

          <LuckyWheelCard
            cost={profile?.spinCostPoints ?? 10_000}
            points={wheelPoints}
            onEarnPoints={() => navigate('/loyalty')}
            onSpin={handleSpin}
            onResult={wheelPrize.onResult}
          />

          {/* Lối vào Đổi rác lấy quà (spec 4.9) */}
          {publicConfig.waste.enabled && (
            <GameLinkRow
              icon={Recycle}
              title="Đổi rác lấy quà"
              badge="Mới"
              hint="Giọt nước dùng trong Vườn, Điểm Xanh dùng để mua sắm"
              onClick={() => navigate('/recycle')}
            />
          )}
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

          {garden && !plotsOpen && (
            <Text variant="caption" tone="secondary" as="div">
              {vi.game.newbie.plots.locked}
            </Text>
          )}

          {/* Sổ tay loài cây (Phase 3) — sưu tập khi thu hoạch */}
          {codex && codex.length > 0 && <SpeciesCodex codex={codex} />}

          {/* Tác động xanh (§6.7.7 — phần khả thi từ treesPlanted) */}
          <EcoImpact eco={eco} totalSeeds={profile?.totalSeeds} forest={forest} />

          <TreeFund
            treePointsPrice={profile?.treePointsPrice}
            points={fundPoints}
            onEarnPoints={() => navigate('/loyalty')}
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
            <FriendGifts
              friends={friends}
              giftPending={giftM.isPending}
              giftVariables={giftM.variables}
              onGift={(recipientId) => giftM.mutate(recipientId)}
            />
          )}

          <WeeklyLeaderboard board={board} />

          {seasonBoard && seasonBoard.length > 0 && <SeasonLeaderboard rows={seasonBoard} />}

          {/* Bảng tin cộng đồng (§6.14.12) */}
          <GameLinkRow
            icon={MessagesSquare}
            title={vi.game.newbie.community.feedTitle}
            hint={vi.game.newbie.community.feedHintReadOnly}
            onClick={() => navigate('/feed')}
          />
        </GameTabPanel>
      </div>

      {/* Hộp kết quả vòng quay: ngoài khối tab để vẫn hiện khi người chơi đã đổi tab trong lúc quay. */}
      <WheelPrizeSheet {...wheelPrize.sheet} onUseCoupon={() => navigate('/browse')} />

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

      {/* Harvest celebration */}
      <HarvestCelebration
        open={harvested}
        coupons={harvestCoupons}
        guest={harvestMeta?.guest ?? false}
        onLogin={() => {
          setHarvested(false);
          void login();
        }}
        certificate={harvestCert}
        species={harvestSpecies}
        points={harvestPoints}
        couponCapped={harvestMeta?.couponCapped ?? null}
        nextTarget={harvestMeta?.nextTarget ?? null}
        onClose={() => setHarvested(false)}
        onUseCoupon={() => {
          setHarvested(false);
          navigate('/browse');
        }}
        onShare={shareHarvest}
      />
    </>,
  );
}
