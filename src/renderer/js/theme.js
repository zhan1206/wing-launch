// 主题应用（独立模块，避免 main.mjs 循环引用）
export async function applyTheme(settings) {
  const t = settings?.theme || {};
  const mode = t.mode === 'system'
    ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : (t.mode || 'dark');
  document.body.dataset.mode = mode;
  // 设计稿（Pinguo）优先：主色固定 #0066cc，不随自定义主题色改变
  const usePinguo = document.body.dataset.design === 'pinguo';
  document.documentElement.style.setProperty('--accent', usePinguo ? '#0066cc' : (t.color || '#4f8cff'));
  const bg = document.querySelector('#bg-layer');
  if (!bg) return;
  if (t.background) {
    bg.style.backgroundImage = `url("${t.background}")`;
    bg.classList.add('has-image');
  } else {
    bg.classList.remove('has-image');
    bg.style.backgroundImage = '';
  }
  bg.style.setProperty('--bg-blur', `${t.blur ?? 0}px`);
  bg.style.setProperty('--bg-dim', String(t.dim ?? 0.35));
  document.body.classList.toggle('layout-immersive', (settings.homepage || 'classic') === 'immersive');
}
