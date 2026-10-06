import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { handleCallback } from './esi/client';
import { t } from './i18n';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

// Pyfa-parity: the native browser context menu is suppressed app-wide — right-click opens
// our own menus (module rows, market items, fits, bays). Editable fields keep theirs
// for copy/paste.
document.addEventListener('contextmenu', (e) => {
  const el = e.target as HTMLElement;
  if (el.closest('input, textarea, select, [contenteditable]')) return;
  e.preventDefault();
});

// EVE SSO redirect lands on <base>/esi/callback?code=…&state=… — exchange it, then bounce back.
if (location.pathname.endsWith('/esi/callback')) {
  const q = new URLSearchParams(location.search);
  const errEl = document.getElementById('root')!;
  root.render(<div className="boot">{t('Signing in with EVE Online…')}</div>);
  handleCallback(q.get('code') ?? '', q.get('state') ?? '')
    .then((returnTo) => location.replace(returnTo))
    .catch((e) => { errEl.innerHTML = `<div class="boot">${t('ESI sign-in failed')}: ${String(e).replace(/[<>]/g, '')} <a href="${import.meta.env.BASE_URL}">${t('back')}</a></div>`; });
} else {
  root.render(<StrictMode><App /></StrictMode>);
}
