import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { loadOriginalXboxUi } from './XboxIcons';
import { DesktopGuideApp } from './DesktopGuideApp';
import './styles.css';
import './xbox-mode.css';
import './xbox-shell.css';
import './xbox-library.css';

loadOriginalXboxUi();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{window.location.hash === '#desktop-guide' ? <DesktopGuideApp /> : <App />}</React.StrictMode>,
);

import './settings-frame.css';
