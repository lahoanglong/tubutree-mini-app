import { useState } from 'react';
import { Page, useSnackbar, useNavigate } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getGameProfile,
  checkIn,
  collectDew,
  buyStreakFreeze,
  repairStreak,
  spin,
  getTodayQuiz,
  answerQuiz,
  waterTree,
  buyTree,
  getLeaderboard,
  getMissions,
  claimMission,
  getForest,
  getCommunity,
  getCollection,
  getSeason,
  getSeasonLeaderboard,
  getFriends,
  giftWater,
  getGarden,
  unlockPlot,
  waterPlot,
  fetchSeasonPass,
  claimSeasonPass,
  type HarvestSpecies,
} from '../services/game-api';
import { useAuthStore } from '../store/auth';
import { ErrorState } from '../components/ui/empty-state';
import { haptic } from '../utils/haptic';
import { getErrorMessage } from '../services/api';
import { vi } from '../i18n/vi';
import { MessagesSquare, Recycle } from 'lucide-react';
import { formatDrops, formatNumber, formatXu } from '../utils/format';
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

export default function GamePage() {
  const status = useAuthStore((s) => s.status);
  const login = useAuthStore((s) => s.login);
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const authed = status === 'authenticated';

  const { data: profile, isLoading, isError, error: profileError, refetch } = useQuery({
    queryKey: ['game', 'profile'],
    queryFn: getGameProfile,
    enabled: authed,
  });
  const { data: quiz } = useQuery({ queryKey: ['game', 'quiz'], queryFn: getTodayQuiz, enabled: authed });
  const { data: board } = useQuery({ queryKey: ['game', 'board'], queryFn: getLeaderboard });
  const { data: missions } = useQuery({ queryKey: ['game', 'missions'], queryFn: getMissions, enabled: authed });
  const { data: forest } = useQuery({ queryKey: ['game', 'forest'], queryFn: getForest, enabled: authed });
  const { data: community } = useQuery({ queryKey: ['game', 'community'], queryFn: getCommunity, enabled: authed });
  const { data: codex } = useQuery({ queryKey: ['game', 'collection'], queryFn: getCollection, enabled: authed });
  const { data: season } = useQuery({ queryKey: ['game', 'season'], queryFn: getSeason });
  const { data: seasonBoard } = useQuery({ queryKey: ['game', 'seasonBoard'], queryFn: getSeasonLeaderboard });
  const { data: friends } = useQuery({ queryKey: ['game', 'friends'], queryFn: getFriends, enabled: authed });
  const { data: garden } = useQuery({ queryKey: ['game', 'garden'], queryFn: getGarden, enabled: authed });
  const { data: seasonPass } = useQuery({ queryKey: ['game', 'seasonPass'], queryFn: fetchSeasonPass, enabled: authed });

  // Quiz nhiều câu/ngày: theo dõi câu đã trả lời client-side để hiện câu kế tiếp (§6.7.8).
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());
  const currentQuiz = quiz?.find((q) => !answeredIds.has(q.id));
  // Reveal "Bạn có biết…" sau khi trả lời, trước khi sang câu kế.
  const [reveal, setReveal] = useState<QuizReveal | null>(null);
  const [harvested, setHarvested] = useState(false);
  const [harvestCoupon, setHarvestCoupon] = useState<string | null>(null);
  const [harvestCert, setHarvestCert] = useState<string | null>(null);
  const [harvestSpecies, setHarvestSpecies] = useState<HarvestSpecies | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['game'] });
    void queryClient.invalidateQueries({ queryKey: ['me'] });
    // Điểm Xanh/xu vừa đổi → màn Thanh toán đọc số dư từ ['loyalty']/['coins'], phải làm mới
    // cùng lúc, nếu không khách vừa tiêu xong sang checkout vẫn thấy số cũ.
    void queryClient.invalidateQueries({ queryKey: ['loyalty'] });
    void queryClient.invalidateQueries({ queryKey: ['coins'] });
  };

  const checkInM = useMutation({
    mutationFn: checkIn,
    onSuccess: (r) => {
      const parts = [`+${formatDrops(r.seedsEarned)}`];
      if (r.streakFrozeUsed) parts.push('🧊 đã dùng vé giữ lửa');
      if (r.bonusNote) parts.push(r.bonusNote);
      openSnackbar({ text: parts.join(' · '), type: 'success' });
      refresh();
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const dewM = useMutation({
    mutationFn: collectDew,
    onSuccess: (r) => {
      openSnackbar({ text: `Hứng được +${formatDrops(r.seedsEarned)} từ giọt sương sáng 💦`, type: 'success' });
      refresh();
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const freezeM = useMutation({
    mutationFn: buyStreakFreeze,
    onSuccess: (r) => {
      openSnackbar({ text: `Đã mua vé giữ lửa 🧊 (còn ${r.streakFreezes} vé)`, type: 'success' });
      refresh();
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const repairM = useMutation({
    mutationFn: repairStreak,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['game', 'profile'] });
      haptic('medium');
      openSnackbar({ text: vi.game.streakRepair.ok, type: 'success' });
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const giftM = useMutation({
    mutationFn: (recipientId: string) => giftWater(recipientId),
    onSuccess: (r) => {
      openSnackbar({ text: `Đã tặng ${formatDrops(r.amount)} cho bạn 🎁`, type: 'success' });
      refresh();
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const handleSpin = async () => {
    try {
      const r = await spin();
      refresh();
      return r;
    } catch (e) {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      throw e;
    }
  };
  const waterM = useMutation({
    mutationFn: () => waterTree(20),
    onSuccess: (r) => {
      if (r.harvested) {
        setHarvestCoupon(r.reward?.coupon ?? null);
        setHarvestCert(r.reward?.certificate ?? null);
        setHarvestSpecies(r.reward?.species ?? null);
        setHarvested(true); // mở modal celebration
      } else {
        openSnackbar({ text: `Đã tưới · ${formatNumber(r.progress)}/${formatDrops(r.target)}`, type: 'success' });
      }
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['game', 'forest'] });
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const buyTreeM = useMutation({
    mutationFn: buyTree,
    onSuccess: (r) => {
      openSnackbar({ text: `Đã mua 1 cây thật 🌳 (−${formatXu(r.cost)}) · mã ${r.certificateCode}`, type: 'success' });
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['game', 'forest'] });
      void queryClient.invalidateQueries({ queryKey: ['coins'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const onPlotHarvest = (r: { harvested: boolean; progress: number; target: number; reward?: { coupon?: string; certificate?: string; species?: HarvestSpecies } }) => {
    if (r.harvested) {
      setHarvestCoupon(r.reward?.coupon ?? null);
      setHarvestCert(r.reward?.certificate ?? null);
      setHarvestSpecies(r.reward?.species ?? null);
      setHarvested(true);
    } else {
      openSnackbar({ text: `Đã tưới lô · ${formatNumber(r.progress)}/${formatDrops(r.target)}`, type: 'success' });
    }
    refresh();
    void queryClient.invalidateQueries({ queryKey: ['game', 'forest'] });
  };
  const unlockM = useMutation({
    mutationFn: (currency: 'SEEDS' | 'XU') => unlockPlot(currency),
    onSuccess: () => {
      openSnackbar({ text: 'Đã mở lô đất mới 🪴', type: 'success' });
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['coins'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const waterPlotM = useMutation({
    mutationFn: (plotId: string) => waterPlot(plotId, 20),
    onSuccess: onPlotHarvest,
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const claimPassM = useMutation({
    mutationFn: ({ tier, track }: { tier: number; track: 'free' | 'premium' }) => claimSeasonPass(tier, track),
    onSuccess: () => {
      haptic('medium');
      openSnackbar({ text: vi.game.seasonPass.claimOk, type: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['game', 'seasonPass'] });
      void queryClient.invalidateQueries({ queryKey: ['game', 'profile'] });
      void queryClient.invalidateQueries({ queryKey: ['coins'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const claimMissionM = useMutation({
    mutationFn: (code: string) => claimMission(code),
    onSuccess: (r) => {
      haptic('medium');
      openSnackbar({ text: vi.game.missions.claimOk(r.rewardPoints), type: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['game', 'missions'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const answerM = useMutation({
    mutationFn: ({ id, choice }: { id: string; choice: number }) => answerQuiz(id, choice),
    onSuccess: (r, vars) => {
      // Hiện reveal "Bạn có biết…"; chỉ sang câu kế khi user bấm "Câu tiếp theo".
      setReveal({ ...r, quizId: vars.id, choice: vars.choice });
      void queryClient.invalidateQueries({ queryKey: ['game', 'profile'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const nextQuiz = () => {
    if (reveal) setAnsweredIds((prev) => new Set(prev).add(reveal.quizId));
    setReveal(null);
  };

  // Đang silent-login lúc mở app (restore chưa xong) → skeleton thay vì chớp cổng đăng nhập.
  if (status === 'loading' || (authed && isLoading)) {
    return (
      <Page className="page" style={{ background: 'var(--neutral-50)' }}>
        <GameSkeleton />
      </Page>
    );
  }

  // Chỉ hiện cổng đăng nhập khi đã chắc chắn user chưa đăng nhập (status settled, không authenticated)
  // — trước đây gộp chung với nhánh loading khiến user đã logout/login lỗi bị kẹt mãi ở skeleton.
  if (!authed) {
    return (
      <Page className="page">
        <GameLoginGate onLogin={() => void login()} />
      </Page>
    );
  }

  // Profile là dữ liệu chủ đạo của trang (streak/xu/eco-impact) — lỗi thì phải báo rõ,
  // không để rơi xuống render với optional-chaining trông như "mất hết tiến độ".
  if (isError) {
    return (
      <Page className="page" style={{ background: 'var(--neutral-50)' }}>
        <ErrorState message={getErrorMessage(profileError)} onRetry={() => void refetch()} />
      </Page>
    );
  }

  const eco = profile?.ecoImpact;

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 80 }}>

      <GardenHero eco={eco} totalSeeds={profile?.totalSeeds} streakDays={profile?.streakDays} />

      {/* Bảng tin cộng đồng (§6.14.12) */}
      <GameLinkRow
        icon={<MessagesSquare size={18} color="var(--leaf-600)" />}
        title="Bảng tin cộng đồng"
        hint="Khoe thành tích xanh & cổ vũ nhau trồng cây"
        onClick={() => navigate('/feed')}
      />

      {/* Đổi vỏ chai lấy nước (§6.14.6) */}
      <GameLinkRow
        icon={<Recycle size={18} color="var(--leaf-600)" />}
        title="Đổi vỏ chai lấy nước"
        hint="Mang vỏ rỗng đến cửa hàng → nhận 💧 tưới vườn"
        onClick={() => navigate('/refill')}
      />

      {/* Banner mùa/sự kiện (Phase 4) */}
      {season && <SeasonBanner season={season} />}

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

      {/* Hồi sinh chuỗi vừa mất (§streak-repair) — chỉ hiện trong cửa sổ hồi sinh */}
      {profile?.streakRepairable && (
        <StreakRepair
          brokenStreakDays={profile.brokenStreakDays}
          cost={profile.streakRepairCost}
          pending={repairM.isPending}
          onRepair={() => repairM.mutate()}
        />
      )}

      <TreeHealthAlert health={profile?.treeHealth} />

      <TreeActions
        treeXuPrice={profile?.treeXuPrice}
        waterPending={waterM.isPending}
        onWater={() => waterM.mutate()}
        buyPending={buyTreeM.isPending}
        onBuy={() => buyTreeM.mutate()}
      />

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

      {/* Chặng Mùa (Season Pass) — ladder bậc XP theo điểm danh */}
      {seasonPass?.active && seasonPass.tiers && seasonPass.tiers.length > 0 && (
        <SeasonPass
          pass={seasonPass}
          claimPending={claimPassM.isPending}
          claimVariables={claimPassM.variables}
          onClaim={(tier, track) => claimPassM.mutate({ tier, track })}
        />
      )}

      {/* Mốc cộng đồng cây thật (Phase 2) — hồ giọt nước toàn cộng đồng */}
      {community?.goal && <CommunityGoal goal={community.goal} myDrops={community.myDrops} pct={community.pct} />}

      {/* Sổ tay loài cây (Phase 3) — sưu tập khi thu hoạch */}
      {codex && codex.length > 0 && <SpeciesCodex codex={codex} />}

      {/* Tặng nước bạn bè (social) */}
      {friends && friends.length > 0 && (
        <FriendGifts
          friends={friends}
          giftPending={giftM.isPending}
          giftVariables={giftM.variables}
          onGift={(recipientId) => giftM.mutate(recipientId)}
        />
      )}

      {/* Tác động xanh (§6.7.7 — phần khả thi từ treesPlanted) */}
      <EcoImpact eco={eco} totalSeeds={profile?.totalSeeds} forest={forest} />

      <LuckyWheelCard cost={10} onSpin={handleSpin} />

      <QuizCard
        quiz={quiz}
        currentQuiz={currentQuiz}
        answeredCount={answeredIds.size}
        reveal={reveal}
        pending={answerM.isPending}
        onAnswer={(id, choice) => answerM.mutate({ id, choice })}
        onNext={nextQuiz}
      />

      <MissionsCard
        missions={missions}
        streakDays={profile?.streakDays}
        claimPending={claimMissionM.isPending}
        claimVariables={claimMissionM.variables}
        onClaim={(code) => claimMissionM.mutate(code)}
      />

      {seasonBoard && seasonBoard.length > 0 && <SeasonLeaderboard rows={seasonBoard} />}

      <WeeklyLeaderboard board={board} />

      {/* Harvest celebration */}
      {harvested && (
        <HarvestCelebration
          coupon={harvestCoupon}
          certificate={harvestCert}
          species={harvestSpecies}
          onClose={() => setHarvested(false)}
          onUseCoupon={() => {
            setHarvested(false);
            navigate('/browse');
          }}
        />
      )}
    </Page>
  );
}
