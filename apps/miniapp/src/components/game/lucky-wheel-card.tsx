import { FerrisWheel } from 'lucide-react';
import type { SpinResult } from '../../services/game-api';
import { WheelOfFortune } from '../wheel';
import { GameCard } from './game-card';

export function LuckyWheelCard({ cost, onSpin }: { cost: number; onSpin: () => Promise<SpinResult> }) {
  return (
    <GameCard title="Vòng quay may mắn" icon={FerrisWheel}>
      <WheelOfFortune cost={cost} onSpin={onSpin} />
    </GameCard>
  );
}
