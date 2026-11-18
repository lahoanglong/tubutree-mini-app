// Entry point Zalo Mini App.
import { createRoot } from 'react-dom/client';
import 'zmp-ui/zaui.css';
import './css/zaui-bridge.css';
import '@tubutree/design-tokens/src/fonts.css';
import '@tubutree/design-tokens/src/tokens.css';
import './css/tokens.css';
import MyApp from './components/app';
import { startMiniVitals } from './lib/vitals/mini-vitals';

startMiniVitals();

const root = createRoot(document.getElementById('app') as HTMLElement);
root.render(<MyApp />);
