import { createRoot } from 'react-dom/client';
import './styles/global.css';
import './styles/pages.css';
import { App } from './App';
import { useApp } from './store/app';

document.documentElement.classList.add(`platform-${window.samsync ? window.samsync.platform : 'web'}`);
void useApp.getState().init();
createRoot(document.getElementById('root')!).render(<App />);
