import { setState } from '../lib/state.js';

export function renderHome(container: HTMLElement): void {
  container.innerHTML = `
    <div class="page home-page">
      <div class="logo">
        <div class="logo-icon">
          <svg viewBox="0 0 80 80" width="80" height="80">
            <circle cx="40" cy="32" r="20" fill="none" stroke="currentColor" stroke-width="3"/>
            <path d="M20 52 Q40 72 60 52" fill="none" stroke="currentColor" stroke-width="3"/>
            <circle cx="33" cy="28" r="2" fill="currentColor"/>
            <circle cx="47" cy="28" r="2" fill="currentColor"/>
            <path d="M35 36 Q40 40 45 36" fill="none" stroke="currentColor" stroke-width="2"/>
          </svg>
        </div>
        <h1>BabyPhone</h1>
        <p class="subtitle">Dein digitales Babyphone</p>
      </div>

      <div class="role-selection">
        <button class="role-btn baby-btn" id="btn-baby">
          <div class="role-icon">
            <svg viewBox="0 0 48 48" width="48" height="48">
              <circle cx="24" cy="18" r="10" fill="none" stroke="currentColor" stroke-width="2.5"/>
              <circle cx="20" cy="16" r="1.5" fill="currentColor"/>
              <circle cx="28" cy="16" r="1.5" fill="currentColor"/>
              <path d="M21 21 Q24 24 27 21" fill="none" stroke="currentColor" stroke-width="1.5"/>
              <path d="M14 28 Q24 42 34 28" fill="none" stroke="currentColor" stroke-width="2.5"/>
            </svg>
          </div>
          <span class="role-title">Baby</span>
          <span class="role-desc">Dieses Geraet ueberwacht</span>
        </button>

        <button class="role-btn parent-btn" id="btn-parent">
          <div class="role-icon">
            <svg viewBox="0 0 48 48" width="48" height="48">
              <circle cx="24" cy="14" r="8" fill="none" stroke="currentColor" stroke-width="2.5"/>
              <path d="M10 44 Q10 28 24 28 Q38 28 38 44" fill="none" stroke="currentColor" stroke-width="2.5"/>
              <path d="M30 8 L36 4" stroke="currentColor" stroke-width="2"/>
              <path d="M36 4 L38 10" stroke="currentColor" stroke-width="2"/>
            </svg>
          </div>
          <span class="role-title">Eltern</span>
          <span class="role-desc">Benachrichtigungen empfangen</span>
        </button>
      </div>
    </div>
  `;

  document.getElementById('btn-baby')!.addEventListener('click', () => {
    setState({ role: 'baby', page: 'pair' });
  });

  document.getElementById('btn-parent')!.addEventListener('click', () => {
    setState({ role: 'parent', page: 'pair' });
  });
}
