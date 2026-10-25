import { FerrisWheel } from 'lucide-react';
import type { SpinResult } from '../../services/game-api';
import { WheelOfFortune } from '../wheel';
import { GameCard } from './game-card';

export function LuckyWheelCard({
  cost,
  points,
  onEarnPoints,
  onSpin,
  onResult,
}: {
  cost: number;
  points: number | null;
  onEarnPoints: () => void;
  onSpin: () => Promise<SpinResult>;
  onResult: (prize: SpinResult['prize'] | null) => void;
}) {
  return (
    <GameCard title="Vòng quay may mắn" icon={FerrisWheel}>
      <WheelOfFortune cost={cost} points={points} onEarnPoints={onEarnPoints} onSpin={onSpin} onResult={onResult} />
    </GameCard>
  );
}
