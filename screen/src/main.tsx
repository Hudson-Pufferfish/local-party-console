import { render } from '@solidjs/web';
import { App } from './app.tsx';
import './styles.css';

const root = document.getElementById('root');
if (root !== null) render(() => <App />, root);
