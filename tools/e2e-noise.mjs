/* Общий для e2e-проверок фильтр «шума окружения».
   Ошибки консоли бывают двух сортов: наши (ошибки приложения) и окружения —
   сокет «горячей» перезагрузки Vite, dev-404, предупреждения React, недоступный
   внешний lrclib.net. Вторые не должны валывать проверку «в консоли чисто»,
   поэтому список один на все скрипты и его легко читать. */

export const NOISE = [
  /favicon/i,
  /Download the React DevTools/i,
  /React Router Future Flag/i,
  /Failed to load resource: .*404/i,
  /* HMR: дев-сервер за прокси песочницы не может поднять ws-соединение —
     к приложению это отношения не имеет (в Electron сокет не используется) */
  /WebSocket connection to 'ws/i,
  /Content Security Policy.*ws/i,
  (p) => p.includes('Failed to load resource') && p.includes('ERR_CONNECTION_REFUSED'),
  /* доступность lrclib.net проверяется отдельными проверками, а не консолью */
  (p) => /lrclib\.net/i.test(p) && /(Failed to load resource|ERR_|NetworkError|429|503|timeout)/i.test(p),
];

export const isNoise = (p) => NOISE.some((re) => (typeof re === 'function' ? re(p) : re.test(p)));

/** подписка на ошибки страницы; возвращает массив, который наполняется по ходу теста */
export function watchProblems(page) {
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !isNoise(m.text())) problems.push(`console.error: ${m.text()}`);
  });
  return problems;
}
