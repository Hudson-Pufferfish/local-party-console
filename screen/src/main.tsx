import { render } from '@solidjs/web';
import { App } from './app.tsx';
import './styles/base.css';
import './styles/lobby.css';
import './styles/match.css';

const root = document.getElementById('root');
if (root !== null) render(() => <App />, root);
