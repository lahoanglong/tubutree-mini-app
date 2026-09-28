// Entry point Zalo Mini App.
import { createRoot } from 'react-dom/client';
import 'zmp-ui/zaui.css';
import './css/zaui-bridge.css';
import '@tubutree/design-tokens/src/fonts.css';
import '@tubutree/design-tokens/src/tokens.css';
import './css/tokens.css';
import MyApp from './components/app';

const root = createRoot(document.getElementById('app') as HTMLElement);
root.render(<MyApp />);
