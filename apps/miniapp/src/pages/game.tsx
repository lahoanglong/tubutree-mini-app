import { useState, type ReactNode } from 'react';
import { Page, useNavigate } from 'zmp-ui';
import type { HarvestSpecies } from '../services/game-api';
import { useAuthStore } from '../store/auth';
import { ErrorState } from '../components/ui/empty-state';
import { PageHeader } from '../components/ui/page-header';
import { SegmentedTabs } from '../components/ui/segmented-tabs';
import { getErrorMessage } from '../services/api';
import { MessagesSquare, Recycle } from 'lucide-react';
import { GameLoginGate, GameSkeleton } from '../components/game/game-states';
import { GardenHero } from '../components/game/garden-hero';
import { GameLinkRow } from '../components/game/game-link-row';
import { SeasonBanner } from '../components/game/season-banner';
import { TreeHealthAlert } from '../components/game/tree-health-alert';
import { CheckInStreak } from '../components/game/checkin-streak';
import { StreakRepair } from '../components/game/streak-repair';
import { TreeActions } from '../components/game/tree-actions';
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
import { useGameActions, type HarvestReward } from '../components/game/use-game-actions';
import { SEASON_PASS_ENABLED } from '../utils/features';

export default function GamePage() {
  const status = useAuthStore((s) => s.status);
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const authed = status === 'authenticated';

  const { profileQ, quiz, board, missions, forest, community, codex, season, seasonBoard, friends, garden, seasonPass } =
    useGameData(authed);
  const { data: profile, isLoading, isError, error: profileError, refetch } = profileQ;

  // Quiz nhiều câu/ngày: theo dõi câu đã trả lời client-side để hiện câu kế tiếp (§6.7.8).
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());
  const currentQuiz = quiz?.find((q) => !answeredIds.has(q.id));
  // Reveal "Bạn có biết…" sau khi trả lời, trước khi sang câu kế.
  const [reveal, setReveal] = useState<QuizReveal | null>(null);
  const [tab, setTab] = useState<GameTabKey>('today');
  const [harvested, setHarvested] = useState(false);
  const [harvestCoupon, setHarvestCoupon] = useState<string | null>(null);
  const [harvestCert, setHarvestCert] = useState<string | null>(null);
  const [harvestSpecies, setHarvestSpecies] = useState<HarvestSpecies | null>(null);

  const { checkInM, dewM, freezeM, repairM, giftM, handleSpin, waterM, buyTreeM, unlockM, waterPlotM, claimPassM, claimMissionM, answerM } =
    useGameActions({
      onHarvest: (reward: HarvestReward | undefined) => {
        setHarvestCoupon(reward?.coupon ?? null);
        setHarvestCert(reward?.certificate ?? null);
        setHarvestSpecies(reward?.species ?? null);
        setHarvested(true); // mở modal celebration
      },
      onAnswered: (r, vars) => setReveal({ ...r, quizId: vars.id, choice: vars.choice }),
    });
  const wheelPrize = useWheelPrize();
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
  if (status === 'loading' || (authed && isLoading)) return shell(<GameSkeleton />);

  // Chỉ hiện cổng đăng nhập khi đã chắc chắn user chưa đăng nhập (status settled, không authenticated)
  // — trước đây gộp chung với nhánh loading khiến user đã logout/login lỗi bị kẹt mãi ở skeleton.
  if (!authed) return shell(<GameLoginGate onLogin={() => void login()} />);

  // Profile là dữ liệu chủ đạo của trang (streak/xu/eco-impact) — lỗi thì phải báo rõ,
  // không để rơi xuống render với optional-chaining trông như "mất hết tiến độ".
  if (isError) return shell(<ErrorState message={getErrorMessage(profileError)} onRetry={() => void refetch()} />);

  const eco = profile?.ecoImpact;

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
              pending={repairM.isPending}
              onRepair={() => repairM.mutate()}
            />
          )}

          <TreeActions
            treeXuPrice={profile?.treeXuPrice}
            waterPending={waterM.isPending}
            onWater={() => waterM.mutate()}
            buyPending={buyTreeM.isPending}
            onBuy={() => buyTreeM.mutate()}
          />

          {/* Điểm danh — chuỗi 7 ngày (§6.7.2) */}
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

          <LuckyWheelCard cost={10} onSpin={handleSpin} onResult={wheelPrize.onResult} />

          {/* Đổi vỏ chai lấy nước (§6.14.6) */}
          <GameLinkRow
            icon={Recycle}
            title="Đổi vỏ chai lấy nước"
            hint="Mang vỏ rỗng đến cửa hàng → nhận 💧 tưới vườn"
            onClick={() => navigate('/refill')}
          />
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
              unlockVariables={unlockM.variables}
              onUnlock={(currency) => unlockM.mutate(currency)}
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
            title="Bảng tin cộng đồng"
            hint="Khoe thành tích xanh & cổ vũ nhau trồng cây"
            onClick={() => navigate('/feed')}
          />
        </GameTabPanel>
      </div>

      {/* Hộp kết quả vòng quay: ngoài khối tab để vẫn hiện khi người chơi đã đổi tab trong lúc quay. */}
      <WheelPrizeSheet {...wheelPrize.sheet} />

      {/* Harvest celebration */}
      <HarvestCelebration
        open={harvested}
        coupon={harvestCoupon}
        certificate={harvestCert}
        species={harvestSpecies}
        onClose={() => setHarvested(false)}
        onUseCoupon={() => {
          setHarvested(false);
          navigate('/browse');
        }}
      />
    </>,
  );
}
