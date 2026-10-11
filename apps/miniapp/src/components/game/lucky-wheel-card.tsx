import { FerrisWheel } from 'lucide-react';
import type { SpinResult } from '../../services/game-api';
import { WheelOfFortune } from '../wheel';
import { GameCard } from './game-card';

export function LuckyWheelCard({
  cost,
  onSpin,
  onResult,
}: {
  cost: number;
  onSpin: () => Promise<SpinResult>;
  onResult: (prize: SpinResult['prize'] | null) => void;
}) {
  return (
    <GameCard title="Vòng quay may mắn" icon={FerrisWheel}>
      <WheelOfFortune cost={cost} onSpin={onSpin} onResult={onResult} />
    </GameCard>
  );
}
