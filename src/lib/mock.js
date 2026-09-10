/* Демо-библиотека: используется, когда сервер Navidrome недоступен (режим «Демо»).
   Обложки генерируются как SVG data-URI, поэтому не требуют сети. */

const PALETTES = [
  ['#1DB954', '#0b3d1f'], ['#e13300', '#3b0f00'], ['#8400e7', '#210043'],
  ['#1e3264', '#0a1128'], ['#e8115b', '#3d0018'], ['#148a08', '#04250a'],
  ['#ff4632', '#4a0f08'], ['#ffc862', '#4d3a13'], ['#509bf5', '#12305c'],
  ['#af2896', '#360b2e'], ['#056952', '#022019'], ['#d84000', '#3b1300'],
];

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function cover(seed, label = '') {
  const [a, b] = PALETTES[hash(seed) % PALETTES.length];
  const r = hash(seed + 'x') % 360;
  const initials = (label || seed).split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1" gradientTransform="rotate(${r} .5 .5)">
        <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>
      </linearGradient>
    </defs>
    <rect width="600" height="600" fill="url(#g)"/>
    <circle cx="${120 + (hash(seed) % 360)}" cy="${100 + (hash(seed + 'y') % 380)}" r="${80 + (hash(seed + 'z') % 140)}" fill="#ffffff" opacity="0.08"/>
    <circle cx="${60 + (hash(seed + 'q') % 460)}" cy="${60 + (hash(seed + 'w') % 460)}" r="${40 + (hash(seed + 'e') % 90)}" fill="#000000" opacity="0.12"/>
    <text x="50%" y="54%" font-family="Inter,Helvetica,Arial,sans-serif" font-size="190" font-weight="800"
      fill="#ffffff" fill-opacity="0.9" text-anchor="middle">${initials}</text>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

const ARTISTS = [
  ['Aurora Fields', 'Dream Pop'], ['Neon Kassette', 'Synthwave'], ['Мираж 2000', 'Русский синти'],
  ['The Velvet Hours', 'Indie Rock'], ['Kaskade Lake', 'Ambient'], ['Silver Static', 'Shoegaze'],
  ['Полярный Круг', 'Post-Rock'], ['Midnight Tram', 'Lo-Fi'], ['Echo Harbour', 'Electronica'],
  ['Sable & Sons', 'Folk'], ['Гравитация', 'Alt Pop'], ['Nordlys', 'Nordic Jazz'],
  ['Yeat', 'Rage'], ['Summrs', 'Plugg'],
  ['Quality Control', 'Hip-Hop'], ['Quavo', 'Hip-Hop'], ['Offset', 'Hip-Hop'], ['Lil Yachty', 'Hip-Hop'],
];

const ALBUM_WORDS = ['Northern Lights', 'Slow Motion', 'Полночь', 'Paper Boats', 'Analog Heart', 'Февраль',
  'Glass Cathedral', 'Long Way Home', 'Тихий Океан', 'Velvet Noise', 'Aurora', 'Second Sunrise',
  'Kaleidoscope', 'Сны о городе', 'Neon Rain', 'Driftwood', 'Silent Disco', 'Белые ночи',
  'Blue Hour', 'Static Bloom', 'Endless Tape', 'Гербарий', 'Solar Winds', 'Afterglow'];

const TRACK_WORDS = ['Falling Slow', 'Neon Skyline', 'Дожди', 'Runaway Signal', 'Golden Hour', 'Свет',
  'Paper Planes', 'Undertow', 'Северный ветер', 'Cassette Dreams', 'Halogen', 'Тишина',
  'Sleepwalker', 'Ocean Drive', 'Ночной трамвай', 'Marble Skies', 'Fireflies', 'Апрель',
  'Distant Radio', 'Weightless', 'Спутник', 'Cold Coffee', 'Satellites', 'Первый снег',
  'Velvet Rope', 'Slow Burn', 'Города', 'Midnight Kids', 'Aftertaste', 'Лёд'];

function rnd(seed) { let s = hash(String(seed)); return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); }

export const MOCK_FOLDERS = [
  { id: '1', name: 'Основная фонотека' },
  { id: '2', name: 'Винил и раритеты' },
  { id: '3', name: 'Лайв-записи' },
];

export function buildMockLibrary() {
  const artists = ARTISTS.map((a, i) => ({
    id: `ar-${i}`, name: a[0], genre: a[1], albumCount: 0, coverArt: `ar-${i}`,
    bio: `${a[0]} — коллектив, работающий на стыке жанра ${a[1]} и электроники. Записи создаются в небольшой студии, где живые инструменты смешиваются с плёночными петлями.`,
  }));

  const albums = [];
  const songs = [];
  let ti = 0;
  artists.forEach((ar, ai) => {
    const r = rnd(ar.id);
    const count = 2 + Math.floor(r() * 2);
    for (let k = 0; k < count; k++) {
      const id = `al-${ai}-${k}`;
      const name = ALBUM_WORDS[(ai * 3 + k) % ALBUM_WORDS.length];
      const year = 2012 + Math.floor(r() * 13);
      const n = 6 + Math.floor(r() * 6);
      const folderId = MOCK_FOLDERS[(ai + k) % MOCK_FOLDERS.length].id;
      const album = {
        id, name, artist: ar.name, artistId: ar.id, year, genre: ar.genre, folderId,
        songCount: n, coverArt: id, duration: 0, starred: r() > 0.75 ? new Date().toISOString() : undefined,
      };
      for (let t = 0; t < n; t++) {
        const dur = 130 + Math.floor(r() * 180);
        album.duration += dur;

        // совместные треки: часть — с OpenSubsonic-полем artists, часть — только строкой
        const guest = artists[(ai + t + 1) % artists.length];
        const collab = guest.id !== ar.id && t % 4 === 2;
        const collabStringOnly = guest.id !== ar.id && t % 7 === 3 && !collab;
        const display = collab ? `${ar.name} feat. ${guest.name}`
          : collabStringOnly ? `${ar.name}, ${guest.name}`
          : ar.name;

        songs.push({
          id: `tr-${ti++}`, parent: id, folderId, title: TRACK_WORDS[(ti * 7) % TRACK_WORDS.length],
          album: name, albumId: id, artist: display, artistId: ar.id, track: t + 1,
          ...(collab ? {
            displayArtist: display,
            artists: [{ id: ar.id, name: ar.name }, { id: guest.id, name: guest.name }],
          } : {}),
          year, genre: ar.genre, duration: dur, coverArt: id, bitRate: 320, suffix: 'mp3',
          playCount: Math.floor(r() * 60), starred: r() > 0.85 ? new Date().toISOString() : undefined,
        });
      }
      ar.albumCount++;
      albums.push(album);
    }
  });

  /* Показательные случаи для разбора имён исполнителей:
     «Yeat & Summrs» — двое разных, причём artistId указывает на ВТОРОГО
     (так делает Navidrome, когда исполнитель альбома не первый в подписи);
     «Sable & Sons» — наоборот, один коллектив, «&» внутри собственного имени. */
  const yeat = artists.find((a) => a.name === 'Yeat');
  const summrs = artists.find((a) => a.name === 'Summrs');
  if (yeat && summrs) {
    const al = albums.find((a) => a.artistId === yeat.id);
    const s0 = songs.find((x) => x.albumId === al?.id);
    if (s0) {
      s0.title = 'GO2WORK';
      s0.artist = 'Yeat & Summrs';
      s0.artistId = summrs.id;
      delete s0.artists;
      delete s0.displayArtist;
    }
  }

  /* Каверзные подписи: коллектив со знаком «&» в собственном имени рядом с
     настоящей коллаборацией. Клиент должен разрезать одно и не тронуть другое. */
  const sable = artists.find((a) => a.name === 'Sable & Sons');
  if (sable && summrs && yeat) {
    const alS = albums.find((a) => a.artistId === summrs.id);
    const s1 = songs.find((x) => x.albumId === alS?.id);
    if (s1) {
      s1.title = 'Ночной экспресс';
      s1.artist = 'Summrs, Sable & Sons';
      s1.artistId = summrs.id;
      delete s1.artists; delete s1.displayArtist;
    }
    const alB = albums.find((a) => a.artistId === sable.id);
    const s2 = songs.find((x) => x.albumId === alB?.id);
    if (s2) {
      s2.title = 'Тёплый свет';
      s2.artist = 'Sable & Sons feat. Yeat';
      s2.artistId = sable.id;
      delete s2.artists; delete s2.displayArtist;
    }
  }

  /* Четыре участника сразу: «feat.» + запятая + «&». */
  const qc = artists.find((a) => a.name === 'Quality Control');
  if (qc) {
    const alQ = albums.find((a) => a.artistId === qc.id);
    const s3 = songs.find((x) => x.albumId === alQ?.id);
    if (s3) {
      s3.title = 'Intro';
      s3.artist = 'Quality Control feat. Quavo, Offset & Lil Yachty';
      s3.artistId = qc.id;
      delete s3.artists; delete s3.displayArtist;
    }
  }

  const playlists = [
    ['Фокус на работе', 'Спокойное на фоне'], ['Тёплый вечер', 'Ламповое и медленное'],
    ['Дорога', 'Синти и драйв'], ['Открытия недели', 'Свежее из библиотеки'],
    ['Северное настроение', 'Пост-рок и эмбиент'], ['Только гитары', 'Живой звук'],
  ].map(([name, comment], i) => {
    const r = rnd('pl' + i);
    const entry = Array.from({ length: 12 + Math.floor(r() * 14) }, () => songs[Math.floor(r() * songs.length)]);
    // часть плейлистов «расшарена» другими пользователями — как в Navidrome
    const shared = ['anna', 'kirill'][i - 4];
    return {
      id: `pl-${i}`, name, comment,
      owner: shared || 'demo', public: !!shared || i % 2 === 0, coverArt: `pl-${i}`,
      songCount: entry.length, duration: entry.reduce((s, x) => s + x.duration, 0),
      created: new Date(Date.now() - i * 86400000 * 9).toISOString(),
      changed: new Date().toISOString(), entry,
    };
  });

  return { artists, albums, songs, playlists };
}

export const LYRICS_LINES = [
  'Город остывает, гаснут этажи',
  'Мы идём по краю тёплой полосы',
  'Ты держи мне руку, я держу мотив',
  'Всё, что было лишним, тихо позади',
  'И неон стекает в лужи под ногами',
  'Мы почти у дома, слышишь этот бит',
  'Пусть играет дольше, пусть не отпускает',
  'Эта ночь длиннее, чем любой из нас',
];
