/**
 * Сохранение текста файлом: списки, выгрузки, готовые страницы.
 *
 * В десктопном приложении показываем системный диалог «Сохранить как»
 * (через `window.desktop.saveText`): человек сам выбирает, куда положить
 * файл; отмена — не ошибка. В браузере и если диалог недоступен — скачиваем
 * через Blob, как обычную ссылку.
 */

/**
 * @param {string} filename  имя, которое предложит диалог
 * @param {string} text      содержимое
 * @param {object} opts      { ext, title } — расширение и заголовок диалога
 * @returns {Promise<{path?:string, canceled?:boolean}>}
 */
export async function saveTextFile(filename, text, opts = {}) {
  const { ext = 'txt', title = 'Сохранить файл' } = opts || {};
  const desktop = typeof window !== 'undefined' ? window.desktop : null;
  if (typeof desktop?.saveText === 'function') {
    try {
      const r = await desktop.saveText({ name: filename, text, ext, title });
      if (r?.canceled) return { canceled: true };
      if (r?.ok) return { path: r.path };
    } catch {
      // диалог не поднялся — пробуем как в браузере
    }
  }
  const blob = new Blob([text], { type: mimeFor(ext) });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { path: filename };
}

function mimeFor(ext) {
  const e = String(ext || '').replace(/^\./, '').toLowerCase();
  if (e === 'html' || e === 'htm') return 'text/html;charset=utf-8';
  if (e === 'json') return 'application/json;charset=utf-8';
  if (e === 'csv') return 'text/csv;charset=utf-8';
  return 'text/plain;charset=utf-8';
}

export default { saveTextFile };
