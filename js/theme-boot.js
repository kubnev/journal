// Pick the theme before first paint to avoid a flash (settings load asynchronously).
(function () { var t; try { t = localStorage.getItem('journal.theme') || localStorage.getItem('tj.theme'); } catch (e) {}
  document.documentElement.dataset.theme = t === 'light' || t === 'dark' ? t : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); })();
