import { useState } from 'react';
import { Box, Page, Text, Button, useSnackbar, useNavigate } from 'zmp-ui';
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
import { Skeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/empty-state';
import { haptic } from '../utils/haptic';
import { getErrorMessage } from '../services/api';
import { vi } from '../i18n/vi';
import { MessagesSquare, Recycle } from 'lucide-react';
import { copyText } from '../utils/clipboard';
import { formatDrops, formatNumber, formatXu } from '../utils/format';
import { isSameVNDay, rarityColor, rarityLabel } from '../components/game/game-utils';
import { GameCard } from '../components/game/game-card';
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

  const dewCollectedToday = isSameVNDay(profile?.lastDewAt ?? null);
  const checkedInToday = isSameVNDay(profile?.lastCheckInAt ?? null);

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
        <Box p={4} flex flexDirection="column" style={{ gap: 12 }}>
          <Skeleton style={{ height: 180, borderRadius: 'var(--radius-lg)' }} />
          <Skeleton style={{ height: 56, borderRadius: 'var(--radius-lg)' }} />
          <Skeleton style={{ height: 56, borderRadius: 'var(--radius-lg)' }} />
          <Skeleton style={{ height: 140, borderRadius: 'var(--radius-lg)' }} />
        </Box>
      </Page>
    );
  }

  // Chỉ hiện cổng đăng nhập khi đã chắc chắn user chưa đăng nhập (status settled, không authenticated)
  // — trước đây gộp chung với nhánh loading khiến user đã logout/login lỗi bị kẹt mãi ở skeleton.
  if (!authed) {
    return (
      <Page className="page">
        <Box style={{ textAlign: 'center', padding: 48 }}>
          <Text style={{ fontSize: 48 }}>🌱</Text>
          <Text style={{ marginTop: 8 }}>{vi.community.loginToView}</Text>
          <Button style={{ marginTop: 12, background: 'var(--leaf-600)' }} onClick={() => void login()}>
            {vi.auth.loginCta}
          </Button>
        </Box>
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
        streakDays={profile?.streakDays}
        streakFreezes={profile?.streakFreezes}
        streakFreezeCost={profile?.streakFreezeCost}
        checkedInToday={checkedInToday}
        dewCollectedToday={dewCollectedToday}
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

      {seasonBoard && seasonBoard.length > 0 && (
        <GameCard title="💧 Top góp nước mùa này">
          {seasonBoard.map((r) => (
            <Box key={r.rank} flex justifyContent="space-between" style={{ padding: '4px 0', borderTop: r.rank > 1 ? '1px solid var(--neutral-100)' : 'none' }}>
              <Text size="small">
                {r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `#${r.rank}`} {r.nickname}
              </Text>
              <Text size="xSmall" bold style={{ color: 'var(--leaf-700)' }}>
                {formatDrops(r.drops)}
              </Text>
            </Box>
          ))}
        </GameCard>
      )}

      <GameCard title="🏆 Bảng xếp hạng tuần">
        {board && board.length > 0 ? (
          <>
            {/* Podium top 3 */}
            <Box flex alignItems="flex-end" justifyContent="center" style={{ gap: 8, marginBottom: 12 }}>
              {[board[1], board[0], board[2]].map((r, idx) => {
                if (!r) return <Box key={idx} style={{ flex: 1 }} />;
                const isFirst = r.rank === 1;
                const h = isFirst ? 64 : r.rank === 2 ? 48 : 38;
                const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : '🥉';
                return (
                  <Box key={r.rank} style={{ flex: 1, textAlign: 'center' }}>
                    <Text style={{ fontSize: isFirst ? 28 : 22 }}>{medal}</Text>
                    <Text size="xSmall" bold style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.nickname}
                    </Text>
                    <Box
                      style={{
                        height: h,
                        borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
                        background: isFirst ? 'var(--primary-600)' : 'var(--leaf-400)',
                        marginTop: 4,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--neutral-0)',
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      🌳{r.treesPlanted}
                    </Box>
                  </Box>
                );
              })}
            </Box>
            {/* Hạng 4+ */}
            {board.slice(3).map((r) => (
              <Box key={r.rank} flex justifyContent="space-between" style={{ padding: '4px 0', borderTop: '1px solid var(--neutral-100)' }}>
                <Text size="small">
                  #{r.rank} {r.nickname}
                </Text>
                <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                  🔥{r.streak} · 🌳{r.treesPlanted}
                </Text>
              </Box>
            ))}
          </>
        ) : (
          <Text size="small" style={{ color: 'var(--neutral-400)' }}>
            Chưa có dữ liệu xếp hạng.
          </Text>
        )}
      </GameCard>

      {/* Harvest celebration */}
      {harvested && (
        <Box
          onClick={() => setHarvested(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}
        >
          <Box
            onClick={(e) => e.stopPropagation()}
            p={5}
            style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-xl)', textAlign: 'center', maxWidth: 320, width: '100%' }}
          >
            <Text style={{ fontSize: 64 }}>🌳</Text>
            <Text bold size="large" style={{ marginTop: 8 }}>
              Thu hoạch thành công!
            </Text>
            <Text size="small" style={{ color: 'var(--neutral-600)', marginTop: 6 }}>
              Cây ảo của bạn đã lớn — Tubu sẽ góp <b>1 cây thật</b> vào rừng "Rừng Xanh Lên" cùng PanNature 🌿
            </Text>
            {harvestCoupon && (
              <Box
                className="tubu-press"
                mt={3}
                p={3}
                onClick={() => {
                  void copyText(harvestCoupon).then((ok) =>
                    openSnackbar(
                      ok
                        ? { text: 'Đã sao chép mã giảm giá', type: 'success' }
                        : { text: `Không sao chép được — mã của bạn: ${harvestCoupon}`, type: 'info', duration: 4000 },
                    ),
                  );
                }}
                style={{ background: 'var(--leaf-50)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--leaf-600)' }}
              >
                <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
                  Quà thu hoạch — mã giảm giá (chạm để sao chép)
                </Text>
                <Text bold style={{ color: 'var(--leaf-700)', letterSpacing: 1 }}>
                  {harvestCoupon}
                </Text>
              </Box>
            )}
            {harvestCert && (
              <Box mt={2} p={3} style={{ background: 'var(--leaf-50)', borderRadius: 'var(--radius-md)' }}>
                <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
                  Mã chứng nhận cây thật
                </Text>
                <Text bold style={{ color: 'var(--leaf-700)', letterSpacing: 1 }}>
                  {harvestCert}
                </Text>
              </Box>
            )}
            {harvestSpecies && (
              <Box mt={3} p={3} style={{ background: 'var(--leaf-50)', borderRadius: 'var(--radius-md)', border: `1px solid ${rarityColor(harvestSpecies.rarity)}` }}>
                <Text size="xSmall" style={{ color: rarityColor(harvestSpecies.rarity), fontWeight: 700 }}>
                  {rarityLabel(harvestSpecies.rarity)} · Sưu tập mới!
                </Text>
                <Text bold style={{ marginTop: 2 }}>
                  {harvestSpecies.emoji} {harvestSpecies.name}
                </Text>
                {harvestSpecies.ecoFact && (
                  <Text size="xSmall" style={{ color: 'var(--neutral-600)', marginTop: 4 }}>
                    💡 {harvestSpecies.ecoFact}
                  </Text>
                )}
              </Box>
            )}
            {harvestCoupon && (
              <Button
                fullWidth
                variant="secondary"
                onClick={() => {
                  setHarvested(false);
                  navigate('/browse');
                }}
                style={{ marginTop: 12 }}
              >
                Dùng mã giảm giá ngay
              </Button>
            )}
            <Button
              fullWidth
              onClick={() => setHarvested(false)}
              style={{ marginTop: harvestCoupon ? 8 : 20, background: 'var(--leaf-600)' }}
            >
              Tuyệt vời!
            </Button>
          </Box>
        </Box>
      )}
    </Page>
  );
}
