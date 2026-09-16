/*
 * Экран «Статистика»: что, когда и сколько слушал пользователь.
 *
 * Данные — только локальная история прослушиваний (src/lib/playHistory.js),
 * Subsonic «что я слушал» не отдаёт. Все цифры считает src/lib/stats.js.
 *
 * История копится в пределах PLAY_MAX записей, поэтому «Всё время» — это
 * не вся жизнь, а последние несколько сотен прослушиваний; честно подписываем
 * это под заголовком.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useStore from '../state/store';
import { Cover } from '../components/UI';
import api from '../lib/api';
import { useCoverSrc } from '../lib/covers';
import { useDominantColor, vividColor, fmt, plural, songsWord } from '../lib/util';
import {
  buildStats, hoursAndMinutes, shortDate, partOfDayName, RANGES, WEEKDAY_SHORT,
} from '../lib/stats.js';
import { Play, Pause, Shuffle, Clock, ChartIc, FlameIc, MoonIc, TrendIc, TimeIc, Download } from '../components/Icons';

const HERO_FALLBACK = '#4a3fa0';

/* «3 ч 20 мин» — коротко; для крупных цифр отдельно берём hoursAndMinutes */
const hm = (sec) => hoursAndMinutes(sec).text;

const DayChart = ({ days, maxDay, now }) => {
  const max = maxDay || 0;
  return (
    <div className="chart">
      <div className="chart-bars">
        {days.map((d) => {
          const h = max ? Math.max(d.duration ? 5 : 0, Math.round((d.duration / max) * 100)) : 0;
          const tip = d.count
            ? `${shortDate(d.at, now)} · ${songsWord(d.count)} · ${hm(d.duration)}`
            : `${shortDate(d.at, now)} · не слушали`;
          return (
            <div className="bar-wrap" key={d.key} title={tip}>
              <div className={`bar${h ? '' : ' zero'}`} style={{ height: `${h}%` }} />
            </div>
          );
        })}
      </div>
      <div className="chart-foot">
        <span className="muted">{days.length ? shortDate(days[0].at, now) : ''}</span>
        {max ? <span className="muted">самый плотный день — {hm(max)}</span> : null}
        <span className="muted">{days.length ? shortDate(days[days.length - 1].at, now) : ''}</span>
      </div>
    </div>
  );
};

/* Когда слушаем: дни недели × часы */
const Heatmap = ({ byHour, maxHour }) => {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  return (
    <div className="heat">
      <div className="heat-grid" style={{ gridTemplateColumns: `28px repeat(24, 1fr)` }}>
        <div />
        {hours.map((h) => (
          <div className="heat-h" key={`h${h}`}>{h % 3 === 0 ? h : ''}</div>
        ))}
        {byHour.map((row, di) => (
          <React.Fragment key={`r${di}`}>
            <div className="heat-cap">{WEEKDAY_SHORT[di]}</div>
            {row.map((v, h) => {
              const t = maxHour ? v / maxHour : 0;
              return (
                <div
                  key={`c${di}-${h}`}
                  className={`heat-cell${v ? ' on' : ''}`}
                  style={v ? { background: 'var(--accent)', opacity: 0.2 + 0.8 * t } : undefined}
                  title={`${WEEKDAY_SHORT[di]}, ${String(h).padStart(2, '0')}:00 — ${v ? plural(v, 'трек', 'трека', 'треков') : 'не слушали'}`}
                />
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="heat-legend">
        <span className="muted">меньше</span>
        {[0.2, 0.4, 0.6, 0.8, 1].map((o) => (
          <i key={o} className="heat-legend-cell" style={{ background: 'var(--accent)', opacity: o }} />
        ))}
        <span className="muted">больше</span>
      </div>
    </div>
  );
};

export default function Stats() {
  const nav = useNavigate();
  const setUI = useStore((s) => s.setUI);
  const history = useStore((s) => s.playHistory);
  const username = useStore((s) => s.credentials?.username || 'вы');
  const playQueue = useStore((s) => s.playQueue);
  const cur = useStore((s) => s.current());
  const playing = useStore((s) => s.playing);
  const togglePlay = useStore((s) => s.togglePlay);
  const context = useStore((s) => s.context);
  const toast = useStore((s) => s.toast);
  const remember = useStore((s) => s.settings.rememberPlays);
  const demoMode = !!api.demo;

  const [range, setRange] = useState(30);
  const [now, setNow] = useState(() => Date.now());
  const [genres, setGenres] = useState(null);

  /* «сегодня» должно наступать само, даже если экран открыт сутки */
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const s = useMemo(() => buildStats(history, { days: range, now }), [history, range, now]);
  const topCover = s.topArtists[0]?.coverArt || null;
  const coverSrc = useCoverSrc(topCover, 200);
  /* hero держим приглушённым, как на остальных страницах, а графики красим
     яркой версией того же цвета */
  const hero = useDominantColor(coverSrc, HERO_FALLBACK);
  const accent = useMemo(() => vividColor(hero), [hero]);

  useEffect(() => { setUI({ heroColor: hero, pageTitle: 'Статистика' }); }, [hero, setUI]);
  useEffect(() => () => setUI({ pagePlay: null }), [setUI]);

  const rangeLabel = useMemo(
    () => (RANGES.find((r) => r.days === range)?.label || '30 дней').toLowerCase(),
    [range],
  );

  const play = useCallback((list, from = 0, name = 'Статистика') => {
    if (!list?.length) return;
    playQueue(
      list.map((x) => ({ ...x, coverArt: x.coverArt || x.albumId })),
      from,
      { type: 'stats', name },
    );
  }, [playQueue]);

  const ordered = useMemo(() => [...s.items].sort((a, b) => b.at - a.at), [s.items]);

  useEffect(() => {
    if (!ordered.length) { setUI({ pagePlay: null }); return undefined; }
    setUI({ pagePlay: () => play(ordered, 0, `Статистика · ${rangeLabel}`) });
    return undefined;
  }, [ordered, play, rangeLabel, setUI]);

  /* Жанры: в истории их нет, поэтому по верхним альбомам спрашиваем сервер.
     Не вышло — просто не показываем блок.
     Зависимость — не сам список (он новый каждую минуту из-за «сейчас»),
     а набор id альбомов: иначе сервер спрашивали бы раз в минуту. */
  const itemsRef = useRef(s.items);
  itemsRef.current = s.items;
  const albumKey = useMemo(
    () => [...new Set(s.items.map((x) => x.albumId).filter(Boolean))].slice(0, 14).join(','),
    [s.items],
  );

  useEffect(() => {
    let alive = true;
    const ids = albumKey ? albumKey.split(',') : [];
    if (!ids.length) { setGenres([]); return () => { alive = false; }; }
    Promise.all(ids.map((id) => api.getAlbum(id).catch(() => null)))
      .then((albs) => {
        if (!alive) return;
        const genreOf = new Map();
        albs.forEach((r) => {
          const a = r?.album;
          const g = String(a?.genre || '').trim();
          if (a?.id && g) genreOf.set(String(a.id), g);
        });
        const agg = new Map();
        itemsRef.current.forEach((it) => {
          const g = genreOf.get(String(it.albumId));
          if (!g) return;
          const curG = agg.get(g) || { name: g, count: 0, duration: 0 };
          curG.count += 1;
          curG.duration += Number(it.duration) || 0;
          agg.set(g, curG);
        });
        const list = [...agg.values()].sort((a, b) => b.duration - a.duration).slice(0, 6);
        setGenres(list);
      })
      .catch(() => { if (alive) setGenres([]); });
    return () => { alive = false; };
  }, [albumKey]);

  /* Отдельная HTML-страница: чтобы можно было показать топ друзьям */
  const [share, setShare] = useState({ busy: false, done: 0, total: 0 });
  const shareAlive = useRef(false);
  useEffect(() => () => { shareAlive.current = false; }, []);

  const shareHtml = async () => {
    if (share.busy) return;
    const list = [...s.items].sort((a, b) => (b.duration || 0) - (a.duration || 0)).slice(0, 20);
    if (!list.length) return;
    shareAlive.current = true;
    setShare({ busy: true, done: 0, total: list.length });
    try {
      // собираторы страницы грузим по клику: в обычной работе они не нужны
      const [{ buildPlaylistHtml, collectCovers, pageFileName }, { saveTextFile }] = await Promise.all([
        import('../lib/pageExport'),
        import('../lib/saveFile'),
      ]);
      const covers = await collectCovers(list, {
        alive: () => shareAlive.current,
        onProgress: (p) => setShare((st) => (st.busy ? { ...st, done: p.done, total: p.total } : st)),
      });
      if (!shareAlive.current) { setShare({ busy: false, done: 0, total: 0 }); return; }
      const rows = list.map((t) => ({ ...t, cover: covers.get(String(t.id)) || null }));
      const html = buildPlaylistHtml(rows, {
        title: 'Моя статистика',
        kind: `${rangeLabel} · ${songsWord(s.total.count)}`,
        note: `Время прослушивания ${hm(s.total.duration)}. Топ-${list.length} по длительности звучания.`,
      });
      const file = pageFileName('stats');
      const saved = await saveTextFile(file, html, { ext: 'html', title: 'Сохранить страницу' });
      if (saved.canceled) { setShare({ busy: false, done: 0, total: 0 }); return; }
      toast(`Страница готова: ${saved.path || file}`, 'success');
      setShare({ busy: false, done: 0, total: 0 });
    } catch (e) {
      toast(`Не получилось собрать страницу: ${e?.message || e}`, 'error');
      setShare({ busy: false, done: 0, total: 0 });
    }
  };

  const here = context?.type === 'stats';
  const big = hoursAndMinutes(s.total.duration);
  const empty = !history.length;

  const kpi = [
    { icon: <Clock size={18} />, value: s.total.duration ? big.text : '—', cap: 'время прослушивания', sub: s.total.days ? `в ${plural(s.total.days, 'день', 'дня', 'дней')} из ${range || s.total.days}` : '' },
    { icon: <ChartIc size={18} />, value: String(s.total.count), cap: 'прослушанных треков', sub: s.total.count ? `в среднем ${hm(s.avg)} за трек` : '' },
    { icon: <TrendIc size={18} />, value: String(s.total.artists), cap: 'исполнителей', sub: s.total.count ? `${plural(Math.round(s.total.count / Math.max(1, s.total.artists)), 'трек', 'трека', 'треков')} на каждого` : '' },
    { icon: <FlameIc size={18} />, value: String(s.streak), cap: 'дней подряд', sub: s.streak ? 'с музыкой каждый день' : 'серия прервана' },
  ];

  const facts = [];
  if (s.best) {
    facts.push({
      icon: <ChartIc size={16} />,
      value: plural(s.best.count, 'трек', 'трека', 'треков'),
      cap: `рекордный день · ${shortDate(s.best.at, now)}`,
      sub: hm(s.best.duration),
    });
  }
  if (s.peakHour != null) {
    facts.push({
      icon: <TimeIc size={16} />,
      value: `${String(s.peakHour).padStart(2, '0')}:00`,
      cap: `любимое время — ${partOfDayName(s.peakHour)}`,
      sub: `${plural(s.hourTotal[s.peakHour], 'запуск', 'запуска', 'запусков')}`,
    });
  }
  facts.push({
    icon: <MoonIc size={16} />,
    value: `${Math.round(s.nightShare * 100)}%`,
    cap: 'ночных прослушиваний',
    sub: 'с 23:00 до 05:00',
  });
  if (s.longest) {
    facts.push({
      icon: <Clock size={16} />,
      value: fmt(s.longest.duration),
      cap: 'самый длинный трек',
      sub: s.longest.title,
    });
  }

  return (
    <div className="stats-page" style={{ '--accent': accent }}>
      <div className="hero" style={{ '--hero': hero }}>
        {/* обложка исполнителя, который звучал чаще всех: цвет hero считаем по ней же */}
        {topCover ? (
          <Cover id={topCover} size={300} className="hero-art" alt={s.topArtists[0]?.name || ''} />
        ) : (
          <div className="hero-art" style={{ background: `linear-gradient(135deg, ${accent} 0%, #12121a 130%)`, display: 'grid', placeItems: 'center' }}>
            <ChartIc size={84} />
          </div>
        )}
        <div className="stats-hero-text">
          <div className="hero-kind">Что вы слушали</div>
          <h1 className="hero-title">Статистика</h1>
          <div className="hero-sub">
            <b>{username}</b>
            <span className="dot">•</span>
            <span className="muted">{rangeLabel}</span>
            {s.firstAt ? (
              <>
                <span className="dot">•</span>
                <span className="muted">{shortDate(s.firstAt, now)} — {shortDate(s.lastAt, now)}</span>
              </>
            ) : null}
            {demoMode ? (<><span className="dot">•</span><span className="muted">демо-данные</span></>) : null}
          </div>
        </div>
        <div className="stats-hero-num">
          <div className="shn-value">
            {s.total.duration >= 3600 ? (
              <>
                <b>{big.h}</b><span className="shn-unit">ч</span>
                <b>{String(big.m).padStart(2, '0')}</b><span className="shn-unit">мин</span>
              </>
            ) : (
              <>
                <b>{big.m}</b><span className="shn-unit">мин</span>
              </>
            )}
          </div>
          <div className="shn-cap">музыки за {range ? `${range} ${plural(range, 'день', 'дня', 'дней')}` : 'всё время'}</div>
        </div>
      </div>

      <div className="action-bar" style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${hero} 45%, #121212), #121212 120px)` }}>
        <button
          className="play-fab"
          disabled={!ordered.length}
          title={here && playing ? 'Пауза' : ordered.length ? 'Играть всё, что звучало' : 'Играть нечего'}
          onClick={() => (here && playing ? togglePlay() : play(ordered, 0, `Статистика · ${rangeLabel}`))}
        >
          {here && playing ? <Pause size={22} /> : <Play size={22} />}
        </button>
        <button
          className="ghost-btn"
          title="Перемешать и играть"
          disabled={ordered.length < 2}
          onClick={() => play([...ordered].sort(() => Math.random() - 0.5), 0, `Статистика · ${rangeLabel}`)}
        >
          <Shuffle size={20} />
        </button>

        <div className="chips" role="group" aria-label="Промежуток">
          {RANGES.map((r) => (
            <button key={String(r.days)} className={`chip${range === r.days ? ' active' : ''}`} onClick={() => setRange(r.days)}>{r.label}</button>
          ))}
        </div>

        <div style={{ flex: 1 }} />
        {!!ordered.length && (
          <button className="pill-btn" title="Сохранить отдельную HTML-страницу с топом" onClick={shareHtml} disabled={share.busy}>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Download size={13} />
              {share.busy ? `${share.done}/${share.total}` : 'Страница .html'}
            </span>
          </button>
        )}
      </div>

      <div className="page">
        {remember === false && (
          <div className="notice">
            <span>История прослушиваний выключена в настройках — новые треки не записываются, статистика стоит на месте.</span>
            <button className="pill-btn" onClick={() => useStore.getState().updateSettings({ rememberPlays: true })}>Включить</button>
          </div>
        )}

        {empty ? (
          <div className="center-empty">
            <ChartIc size={40} />
            <div>Пока нечего показывать.</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 8, maxWidth: 460 }}>
              Статистика собирается из истории прослушиваний: трек попадает в неё, когда играл около
              20 секунд. История хранится на этом устройстве и не зависит от сервера — послушайте
              что-нибудь, и здесь появятся графики.
            </div>
          </div>
        ) : !s.total.count ? (
          <div className="center-empty">
            <Clock size={40} />
            <div>За этот промежуток музыка не звучала.</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 8, maxWidth: 420 }}>
              В истории {plural(history.length, 'запись', 'записи', 'записей')}, но они старше выбранного
              промежутка. Возьмите пошире — и цифры вернутся.
            </div>
            <button className="pill-btn" style={{ marginTop: 16 }} onClick={() => setRange(null)}>Показать всё время</button>
          </div>
        ) : (
          <div className="stats-wrap">
            <div className="stats-kpi">
              {kpi.map((k) => (
                <div className="stat-card" key={k.cap}>
                  <div className="sc-icon">{k.icon}</div>
                  <div className="sc-value">{k.value}</div>
                  <div className="sc-cap">{k.cap}</div>
                  {!!k.sub && <div className="sc-sub">{k.sub}</div>}
                </div>
              ))}
            </div>

            <div className="stats-block">
              <div className="sb-head">
                <div className="sb-title">Активность по дням</div>
                <div className="sb-note">сколько музыки пришлось на каждый день</div>
              </div>
              <DayChart days={s.daysList} maxDay={s.maxDay} now={now} />
            </div>

            <div className="stats-cols">
              <div className="stats-block">
                <div className="sb-head">
                  <div className="sb-title">Топ исполнителей</div>
                  <div className="sb-note">по времени звучания</div>
                </div>
                {s.topArtists.length ? (
                  <div className="top-list">
                    {s.topArtists.map((a, i) => (
                      <div className="tl-row" key={a.key}>
                        <span className="tl-rank">{i + 1}</span>
                        <Cover id={a.coverArt} size={44} alt={a.name} round />
                        <div className="tl-body">
                          <div className="tl-name">
                            {a.artistId ? <Link to={`/artist/${a.artistId}`} className="ellipsis">{a.name}</Link> : <span className="ellipsis">{a.name}</span>}
                          </div>
                          <div className="tl-bar"><i style={{ width: `${Math.max(2, Math.round(a.share * 100))}%` }} /></div>
                        </div>
                        <div className="tl-meta">
                          <div>{hm(a.duration)}</div>
                          <div className="muted">{plural(a.count, 'трек', 'трека', 'треков')} · {Math.round(a.share * 100)}%</div>
                        </div>
                        <button
                          className="ghost-btn"
                          title={`Играть ${a.name}`}
                          onClick={() => play(s.items.filter((x) => x.artist === a.name || x.artistId === a.artistId), 0, a.name)}
                        >
                          <Play size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : <div className="muted">Нечего показать.</div>}
              </div>

              <div className="stats-block">
                <div className="sb-head">
                  <div className="sb-title">Топ альбомов</div>
                  <div className="sb-note">по времени звучания</div>
                </div>
                {s.topAlbums.length ? (
                  <div className="alb-grid">
                    {s.topAlbums.slice(0, 6).map((a, i) => (
                      <div
                        className={`alb-card${a.albumId ? ' link' : ''}`}
                        key={a.key}
                        onClick={() => a.albumId && nav(`/album/${a.albumId}`)}
                        title={`${a.name} · ${a.artist} · ${hm(a.duration)}`}
                      >
                        <div className="alb-cover">
                          <Cover id={a.coverArt || a.albumId} size={120} alt={a.name} />
                          <span className="alb-rank">{i + 1}</span>
                          <span className="alb-play" onClick={(e) => { e.stopPropagation(); play(s.items.filter((x) => (x.albumId && x.albumId === a.albumId) || (!x.albumId && x.album === a.name)), 0, a.name); }}>
                            <Play size={16} />
                          </span>
                        </div>
                        <div className="alb-name ellipsis">{a.name}</div>
                        <div className="alb-meta ellipsis muted">{a.artist} · {hm(a.duration)}</div>
                      </div>
                    ))}
                  </div>
                ) : <div className="muted">Нечего показать.</div>}
              </div>
            </div>

            <div className="stats-block">
              <div className="sb-head">
                <div className="sb-title">Когда вы слушаете</div>
                <div className="sb-note">дни недели и часы — где музыка звучит чаще всего</div>
              </div>
              <Heatmap byHour={s.byHour} maxHour={s.maxHour} />
            </div>

            {!!(genres && genres.length) && (
              <div className="stats-block">
                <div className="sb-head">
                  <div className="sb-title">Жанры</div>
                  <div className="sb-note">по альбомам, с которых звучали треки</div>
                </div>
                <div className="gen-list">
                  {genres.map((g, i) => {
                    const max = genres[0].duration || 1;
                    return (
                      <div className="gen-row" key={g.name}>
                        <div className="gen-name ellipsis">{g.name}</div>
                        <div className="gen-bar"><i style={{ width: `${Math.max(3, Math.round((g.duration / max) * 100))}%`, opacity: 1 - i * 0.12 }} /></div>
                        <div className="gen-val muted">{hm(g.duration)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {!!facts.length && (
              <div className="stats-block">
                <div className="sb-head">
                  <div className="sb-title">Мелочи, которые приятно знать</div>
                </div>
                <div className="facts">
                  {facts.map((f) => (
                    <div className="fact" key={f.cap}>
                      <div className="fact-ic">{f.icon}</div>
                      <div className="fact-value">{f.value}</div>
                      <div className="fact-cap">{f.cap}</div>
                      {!!f.sub && <div className="fact-sub muted ellipsis">{f.sub}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {range === null && (
              <div className="muted" style={{ fontSize: 12, textAlign: 'center' }}>
                История хранит последние несколько сотен прослушиваний — «всё время» считается по ней.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
