/* Проверка блокировки исполнителей без запуска браузера:
     node tools/test-banned.mjs
   Выход с кодом 1, если сопоставление работает неверно. */

import { bannedKeys, isBannedArtist, trackHasBannedArtist, filterBannedTracks } from '../src/lib/banned.js';

let failed = 0;
const ok = (name, cond, info = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name}${info ? ` → ${info}` : ''}`); }
};

/* ---------- ключи списка ---------- */
const keys = bannedKeys([
  { id: 'ar-1', name: 'Aurora Fields' },
  { id: null, name: '  Ночной трамвай  ' },
]);
ok('имя режется по краям и в нижний регистр', keys.has('ночной трамвай'), [...keys].join(', '));
ok('id попадает в ключи как id:<id>', keys.has('id:ar-1'), [...keys].join(', '));
ok('пустой список даёт пустые ключи', bannedKeys(null).size === 0 && bannedKeys([]).size === 0);

/* ---------- исполнитель ---------- */
ok('исполнитель строка — совпало', isBannedArtist(keys, 'AURORA FIELDS'));
ok('исполнитель {id} — совпало', isBannedArtist(keys, { id: 'ar-1', name: 'другое имя' }));
ok('исполнитель {name} — совпало', isBannedArtist(keys, { name: 'Ночной Трамвай' }));
ok('чужой исполнитель — не совпало', !isBannedArtist(keys, { id: 'ar-9', name: 'Кто-то ещё' }));
ok('пустой список никого не банит', !isBannedArtist(bannedKeys([]), 'Aurora Fields'));

/* ---------- трек ---------- */
const t = (artist, extra = {}) => ({ id: 's-1', title: 'Песня', artist, ...extra });

ok('бан по имени трека', trackHasBannedArtist(keys, t('Aurora Fields')));
ok('бан по artistId трека', trackHasBannedArtist(keys, t('Любой', { artistId: 'ar-1' })));
ok('бан участника «A feat. B»', trackHasBannedArtist(keys, t('Кто-то feat. Aurora Fields')));
ok('бан по всей подписи целиком', trackHasBannedArtist(keys, t('Ночной трамвай')));
ok('чужой трек не тронут', !trackHasBannedArtist(keys, t('Другой исполнитель', { artistId: 'ar-7' })));
ok('без списка никто не заблокирован', !trackHasBannedArtist(bannedKeys([]), t('Aurora Fields')));
ok('пустой трек не падает', !trackHasBannedArtist(keys, null) && !trackHasBannedArtist(keys, {}));

/* ---------- фильтр списка ---------- */
const list = [
  t('Aurora Fields'),
  t('Другой исполнитель'),
  t('Кто-то feat. Aurora Fields'),
  t('Ночной трамвай'),
  t('Третий'),
];
const left = filterBannedTracks(keys, list);
ok('из пяти треков убраны три', left.length === 2, `осталось ${left.length}`);
ok('остались только чужие', left.every((x) => !trackHasBannedArtist(keys, x)));
ok('без бана список не меняется', filterBannedTracks(bannedKeys([]), list).length === list.length);
ok('не-массив не ломается', Array.isArray(filterBannedTracks(keys, null)) && !filterBannedTracks(keys, null).length);

console.log(failed ? `\nПровалено проверок: ${failed}` : '\nблокировка исполнителей считается верно');
process.exit(failed ? 1 : 0);
