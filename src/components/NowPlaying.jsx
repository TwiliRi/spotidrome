import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useStore from '../state/store';
import { AUTODJ_MODES } from '../lib/autodj';
import api from '../lib/api';
import { useCoverSrc } from '../lib/covers';
import engine from '../lib/audio';
import { Cover, Slider } from './UI';
import ArtistLinks, { useArtistMenuItems, useArtistList } from './ArtistLinks';
import { resolveArtistId } from '../lib/artists';
import { volumeLabel } from '../lib/audio';
import { useDominantColor, fmt, songsWord } from '../lib/util';
import {
  Play, Pause, Next, Prev, Shuffle, Repeat, RepeatOne, Heart, HeartFill, Collapse, Plus,
  QueueIc, MicIc, VolHigh, VolLow, VolMute, Sliders, Download, Check, DotsH, Expand, ArtistIc,
  ThumbDown, ThumbDownFill, SyncIc, Minus, TimeIc, FolderIc, Share,
} from './Icons';
import { shareTrackPage } from '../lib/trackPage';

/* ---------------- canvas-визуализатор ---------------- */
function Visualizer({ accent }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const BARS = 52;
    const values = new Float32Array(BARS);
    const data = new Uint8Array(128);
    let raf, t = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, r.width * dpr);
      canvas.height = Math.max(1, r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      const r = canvas.getBoundingClientRect();
      const w = r.width, h = r.height;
      ctx.clearRect(0, 0, w, h);
      const spec = engine.getSpectrum(data);
      const playing = engine.playing;
      t += 0.045;

      for (let i = 0; i < BARS; i++) {
        let target;
        if (spec) {
          const idx = Math.floor(Math.pow(i / BARS, 1.35) * (spec.length * 0.72));
          target = (spec[idx] || 0) / 255;
        } else {
          // демо-режим: живая псевдо-волна
          const wobble = 0.5 + 0.5 * Math.sin(t * (0.9 + i * 0.05) + i * 0.6);
          const swell = 0.55 + 0.45 * Math.sin(t * 0.55 + i * 0.12);
          const tilt = 1 - Math.pow(i / BARS, 1.6) * 0.55;
          target = playing ? Math.min(1, (0.3 + 0.75 * wobble * swell) * tilt) : 0.02;
        }
        values[i] += (target - values[i]) * (target > values[i] ? 0.45 : 0.12);
      }

      const gap = 2;
      const bw = (w - gap * (BARS - 1)) / BARS;
      const grad = ctx.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0.14)');
      grad.addColorStop(0.35, accent);
      grad.addColorStop(0.8, `color-mix(in srgb, ${accent} 45%, #ffffff)`);
      grad.addColorStop(1, '#ffffff');
      ctx.fillStyle = grad;
      ctx.shadowColor = accent;
      ctx.shadowBlur = 14;

      for (let i = 0; i < BARS; i++) {
        const v = Math.max(0.02, values[i]);
        const bh = Math.max(3, v * h * 0.98);
        const x = i * (bw + gap);
        const y = h - bh;
        const rad = Math.min(bw / 2, 3);
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.lineTo(x, y + rad);
        ctx.quadraticCurveTo(x, y, x + rad, y);
        ctx.lineTo(x + bw - rad, y);
        ctx.quadraticCurveTo(x + bw, y, x + bw, y + rad);
        ctx.lineTo(x + bw, h);
        ctx.closePath();
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [accent]);

  return <canvas className="np2-viz" ref={ref} />;
}

/* ---------------- текст песни ----------------
   Берём у api.getLyrics: сначала сервер (теги/.lrc), потом LRCLIB — там текст
   уже синхронизирован построчно, а иногда и пословно (расширенный LRC).
   Поправку «текст спешит/отстаёт» крутим на месте, без повторного запроса. */
const OFFSET_STEP = 0.5;
const OFFSET_LIMIT = 30;

function LyricsPane({ track, time, onSeek, immersive }) {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState('');
  const [retry, setRetry] = useState(0);
  const force = useRef(false);      // только ближайшая загрузка игнорирует кэш
  const boxRef = useRef(null);
  const activeRef = useRef(null);
  const lrclibOn = settings.lrclib !== false;
  const offset = Number(settings.lyricsOffset) || 0;
  const offsetMs = Math.round(offset * 1000);

  useEffect(() => {
    if (!track) { setData(null); return; }
    let alive = true;
    setLoading(true);
    setData(null);
    setErr('');
    const mustFetch = force.current;
    api.getLyrics(track, { lrclib: lrclibOn, force: mustFetch })
      .then((l) => {
        if (!alive) return;
        force.current = false;
        setData(l); setLoading(false); setSearching(false); setErr('');
      })
      .catch((e) => {
        if (!alive) return;
        force.current = false;
        setErr(e?.message || 'Текст найти не удалось');
        setLoading(false);
        setSearching(false);
      });
    return () => { alive = false; };
  }, [track?.id, lrclibOn, retry]); // eslint-disable-line

  const shift = (delta) => {
    const next = Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, Math.round((offset + delta) * 10) / 10));
    updateSettings({ lyricsOffset: next });
  };
  const find = () => { force.current = true; setSearching(true); setRetry((r) => r + 1); };

  const ms = time * 1000 + offsetMs;
  const lines = data?.lines || [];
  const activeIdx = useMemo(() => {
    if (!data?.synced) return -1;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].start != null && lines[i].start <= ms + 200) idx = i; else break;
    }
    return idx;
  }, [data, ms]);   // eslint-disable-line

  useEffect(() => {
    if (activeRef.current && boxRef.current) {
      const c = boxRef.current, el = activeRef.current;
      c.scrollTo({ top: el.offsetTop - c.clientHeight * 0.36, behavior: 'smooth' });
    }
  }, [activeIdx]);

  const srcLabel = data ? (data.instrumental ? 'инструментал' : data.synced ? 'синхронно' : 'без синхронизации') : '';
  const head = data && (
    <div className={`lyr-head${immersive ? ' immersive' : ''}`}>
      <span className="lyr-src">
        {data.source === 'lrclib' ? 'LRCLIB' : data.source === 'demo' ? 'демо' : 'сервер'}
        {srcLabel && <em> · {srcLabel}</em>}
      </span>
      {data.synced && (
        <span className="lyr-offset">
          <button className="lyr-btn" title="Текст на 0.5 с раньше" onClick={() => shift(-OFFSET_STEP)}><Minus size={12} /></button>
          <button
            className={`lyr-val${offset ? ' on' : ''}`}
            title="Сбросить поправку синхронизации"
            onClick={() => offset && shift(-offset)}
          >
            <TimeIc size={12} /> {offset > 0 ? '+' : ''}{offset.toFixed(1)} с
          </button>
          <button className="lyr-btn" title="Текст на 0.5 с позже" onClick={() => shift(OFFSET_STEP)}><Plus size={12} /></button>
        </span>
      )}
      <span className="grow" />
      {data.url && (
        <a className="lyr-link" href={data.url} target="_blank" rel="noreferrer" title="Открыть текст на lrclib.net">lrclib.net</a>
      )}
      <button className="lyr-btn round" title="Найти текст заново (LRCLIB)" onClick={find} disabled={searching}>
        <SyncIc size={13} />
      </button>
    </div>
  );

  if (loading) {
    return <>{head}<div className="np2-empty"><div className="spinner" />{searching && <b>ищу текст на LRCLIB…</b>}</div></>;
  }
  if (!data) {
    return (
      <div className="np2-empty">
        <MicIc size={26} />
        <b>{err ? 'Текст не найден' : 'Текста нет'}</b>
        {err && <div className="lyr-err">{err}</div>}
        <div style={{ maxWidth: 340, fontSize: 13, lineHeight: 1.6 }}>
          Navidrome отдаёт тексты из тегов трека или из .lrc-файла рядом с ним. Если их нет —
          можно подтянуть синхронный текст из открытой базы LRCLIB.
        </div>
        {!lrclibOn
          ? <button className="pill-btn" onClick={() => updateSettings({ lrclib: true })}>Включить поиск LRCLIB</button>
          : <button className="pill-btn" onClick={find} disabled={searching}>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><SyncIc size={13} /> {searching ? 'ищу…' : 'Искать на LRCLIB'}</span>
            </button>}
      </div>
    );
  }
  if (data.instrumental && !lines.length) {
    return (
      <>{head}
        <div className="np2-empty">
          <MicIc size={26} /><b>Инструментал</b>
          <div style={{ fontSize: 13 }}>Слов в этом треке нет — LRCLIB подтверждает, что он без вокала.</div>
        </div>
      </>
    );
  }

  return (
    <>
      {head}
      <div className={`lyr${data.synced ? '' : ' plain'}${immersive ? ' immersive' : ''}`} ref={boxRef}>
        {lines.map((l, i) => {
          const dist = Math.abs(i - activeIdx);
          const cls = !data.synced ? '' : i === activeIdx ? 'active' : i < activeIdx ? 'past' : dist > 4 ? 'far' : '';
          const words = data.synced && i === activeIdx && l.words?.length ? l.words : null;
          return (
            <p
              key={i}
              ref={i === activeIdx ? activeRef : null}
              className={cls}
              onClick={() => data.synced && l.start != null && onSeek(Math.max(0, (l.start - offsetMs) / 1000))}
            >
              {words
                ? words.map((w, j) => {
                    const t = w.start;
                    const end = words[j + 1] ? words[j + 1].start : (lines[i + 1]?.start ?? t + 3000);
                    return <span key={j} className={`w${t <= ms && ms < end ? ' on' : ''}`}>{w.text}{j < words.length - 1 ? ' ' : ''}</span>;
                  })
                : (l.text || '♪')}
            </p>
          );
        })}
      </div>
    </>
  );
}


/* ---------------- очередь ---------------- */
function QueuePane() {
  const { queue, index, jumpTo, context, settings, setAutoDj, toggleAutoDj, autodjBusy } = useStore();
  const upcoming = queue.slice(index + 1);
  const dj = settings.autodj || {};
  return (
    <div className="np2-list">
      <div className="np2-dj">
        <div className={`switch sm${dj.enabled ? ' on' : ''}`} onClick={toggleAutoDj}><i /></div>
        <div className="np2-dj-t">
          <b>AutoDJ</b>
          <span>{dj.enabled ? (autodjBusy ? 'подбираю треки…' : 'очередь продолжается сама') : 'очередь закончится последним треком'}</span>
        </div>
        {dj.enabled && (
          <select className="np2-dj-sel" value={dj.mode} onChange={(e) => setAutoDj({ mode: e.target.value })}>
            {AUTODJ_MODES.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
      </div>
      <div className="head">Сейчас играет</div>
      {queue[index] && (
        <div className="np2-item cur">
          <Cover id={queue[index].coverArt || queue[index].albumId} size={90} alt="" />
          <div className="m">
            <div className="n">{queue[index].title}</div>
            <div className="s">{queue[index].artist}</div>
          </div>
        </div>
      )}
      <div className="head">Далее{context?.name ? ` · ${context.name}` : ''}</div>
      {!upcoming.length && <div className="s" style={{ padding: '4px 12px', color: 'rgba(255,255,255,.5)', fontSize: 13 }}>Очередь заканчивается</div>}
      {upcoming.map((t, i) => (
        <button className={`np2-item${t._dj ? ' dj' : ''}`} key={`${t.id}-${i}`} onClick={() => jumpTo(index + 1 + i)}>
          <Cover id={t.coverArt || t.albumId} size={90} alt="" />
          <div className="m">
            <div className="n">{t.title}</div>
            <div className="s">{t._dj ? `AutoDJ · ${t.artist}` : t.artist}</div>
          </div>
          <div className="d">{fmt(t.duration)}</div>
        </button>
      ))}
    </div>
  );
}

/* ---------------- об исполнителе ---------------- */
function ArtistPane({ track, onClose }) {
  const nav = useNavigate();
  const { playQueue } = useStore();
  const [state, setState] = useState({ loading: true, artist: null, info: null, top: [], albums: [] });

  // у трека может быть несколько исполнителей — между ними можно переключаться
  const people = useArtistList(track);
  const [sel, setSel] = useState(0);
  useEffect(() => { setSel(0); }, [track?.id]);
  const chosen = people[Math.min(sel, Math.max(people.length - 1, 0))] || null;

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      const id = chosen?.id || (chosen?.name ? await resolveArtistId(chosen.name) : null);
      if (!alive) return;
      if (!id) { setState({ loading: false, artist: null, info: null, top: [], albums: [] }); return; }
      const [a, info, top] = await Promise.all([
        api.getArtist(id).catch(() => null),
        api.getArtistInfo(id).catch(() => null),
        api.getTopSongs(chosen.name, 5).catch(() => []),
      ]);
      if (!alive) return;
      setState({ loading: false, artist: a?.artist || null, albums: a?.albums || [], info, top });
    })();
    return () => { alive = false; };
  }, [chosen?.id, chosen?.name]); // eslint-disable-line

  const chips = people.length > 1 ? (
    <div className="np2-artist-chips">
      {people.map((a, i) => (
        <button key={`${a.id || a.name}-${i}`} className={`chip${i === sel ? ' on' : ''}`} onClick={() => setSel(i)}>
          {a.name}
        </button>
      ))}
    </div>
  ) : null;

  if (state.loading) return <div className="np2-artist-tab">{chips}<div className="np2-empty"><div className="spinner" /></div></div>;
  if (!state.artist) {
    return (
      <div className="np2-artist-tab">
        {chips}
        <div className="np2-empty"><ArtistIc size={26} /><b>Нет данных об исполнителе</b></div>
      </div>
    );
  }

  const bio = state.info?.biography ? String(state.info.biography).replace(/<[^>]+>/g, '') : null;

  return (
    <div className="np2-artist-tab">
      {chips}
      <div className="hero-row">
        <Cover id={state.artist.coverArt || state.artist.id} size={200} alt={state.artist.name} />
        <div style={{ minWidth: 0 }}>
          <h4>{state.artist.name}</h4>
          <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 13, marginTop: 4 }}>
            {state.albums.length} альбомов{state.artist.genre ? ` · ${state.artist.genre}` : ''}
          </div>
          <button
            className="pill-btn" style={{ marginTop: 10 }}
            onClick={() => { onClose(); nav(`/artist/${state.artist.id}`); }}
          >
            Открыть страницу
          </button>
        </div>
      </div>

      {bio && <p>{bio.slice(0, 700)}</p>}

      {!!state.top.length && (
        <>
          <div className="head" style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,.5)', margin: '18px 0 8px' }}>
            Популярные треки
          </div>
          {state.top.map((t, i) => (
            <button className="np2-item" key={t.id} onClick={() => playQueue(state.top, i, { type: 'artist', name: state.artist.name })}>
              <Cover id={t.coverArt || t.albumId} size={90} alt="" />
              <div className="m"><div className="n">{t.title}</div><div className="s">{t.album}</div></div>
              <div className="d">{fmt(t.duration)}</div>
            </button>
          ))}
        </>
      )}

      {!!state.albums.length && (
        <>
          <div className="head" style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,.5)', margin: '18px 0 8px' }}>
            Альбомы
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 12 }}>
            {state.albums.slice(0, 6).map((al) => (
              <button key={al.id} onClick={() => { onClose(); nav(`/album/${al.id}`); }} style={{ textAlign: 'left' }}>
                <Cover id={al.coverArt || al.id} size={200} alt={al.name} style={{ width: '100%', aspectRatio: 1, borderRadius: 8, objectFit: 'cover' }} />
                <div style={{ fontSize: 12, marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{al.name}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.55)' }}>{al.year || ''}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- главный компонент ---------------- */
export default function NowPlaying() {
  const nav = useNavigate();
  const artistItems = useArtistMenuItems();
  const {
    current, playing, togglePlay, next, prev, time, duration, seek, setUI,
    shuffle, toggleShuffle, repeat, cycleRepeat, toggleStar, starredIds, settings,
    setVolume, toggleMute, offline, download, queue, index, context, addToQueue,
    dislike, undislike, toggleDislike, dislikedIds, setMusicFolder, toast,
  } = useStore();

  const track = current();
  const folder = useStore((st) => (st.showTrackFolder() ? st.folderOfTrack(track) : null));
  const [tab, setTab] = useState('lyrics');
  const [immersive, setImmersive] = useState(false);
  const [sharing, setSharing] = useState('');          // '' | текст прогресса
  const shareAlive = useRef(false);
  const coverSrc = useCoverSrc(track ? (track.coverArt || track.albumId) : null, 600);
  const accent = useDominantColor(coverSrc, '#2f6f4f');

  useEffect(() => () => { shareAlive.current = false; }, []);

  /** Отдельная html-страница трека: звук внутри, текст песни, вид как в Spotify. */
  const shareTrack = async () => {
    if (!track || sharing) return;
    shareAlive.current = true;
    setSharing('Готовлю страницу…');
    try {
      const res = await shareTrackPage(track, {
        src: useStore.getState().srcFor(track),
        accent,
        alive: () => shareAlive.current,
        onProgress: ({ stage, loaded }) => {
          if (!shareAlive.current) return;
          setSharing(stage === 'audio' && loaded
            ? `Скачиваю звук… ${(loaded / 1024 / 1024).toFixed(1)} МБ`
            : 'Готовлю страницу…');
        },
      });
      if (!shareAlive.current) return;
      if (res?.canceled) return;
      if (!res?.ok) { toast('Страницу собрать не удалось', 'error'); return; }
      const size = (res.size / 1024 / 1024).toFixed(1);
      toast(res.audio
        ? `Страница готова: ${res.name} · ${size} МБ`
        : `Страница готова: ${res.name} · звук вклеить не удалось`, res.audio ? 'success' : 'info');
    } catch (e) {
      if (shareAlive.current) toast(`Не получилось: ${e?.message || e}`, 'error');
    } finally {
      shareAlive.current = false;
      setSharing('');
    }
  };

  useEffect(() => {
    const esc = (e) => {
      if (e.key === 'Escape') { immersive ? setImmersive(false) : setUI({ nowPlayingOpen: false }); }
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [setUI, immersive]);

  if (!track) return null;

  const isStar = starredIds.song.has(track.id);
  const isOff = !!offline[track.id];
  const isBanned = dislikedIds.has(track.id);
  const vol = settings.muted ? 0 : settings.volume;
  const VolIcon = vol === 0 ? VolMute : vol < 0.5 ? VolLow : VolHigh;
  const nextTrack = queue[index + 1];
  const total = duration || track.duration || 0;

  const kind = {
    album: 'Играет из альбома', playlist: 'Играет из плейлиста', artist: 'Играет из подборки',
    liked: 'Играет из плейлиста', search: 'Играет из поиска', genre: 'Играет из жанра',
    offline: 'Играет офлайн', queue: 'Играет из очереди',
  }[context?.type] || 'Сейчас играет';

  const openMore = (e) => {
    setUI({ contextMenu: { x: e.clientX, y: e.clientY, items: [
      { label: 'Добавить в очередь', icon: <QueueIc size={14} />, onClick: () => addToQueue(track) },
      { label: 'Добавить в плейлист…', icon: <Plus size={14} />, onClick: () => setUI({ addToOpen: { ids: [track.id], title: `${track.title} — ${track.artist}` } }) },
      isOff
        ? { label: 'Уже доступен офлайн', icon: <Check size={14} /> }
        : { label: 'Скачать для офлайна', icon: <Download size={14} />, onClick: () => download(track) },
      { sep: true },
      track.albumId && { label: 'Перейти к альбому', onClick: () => { setUI({ nowPlayingOpen: false }); nav(`/album/${track.albumId}`); } },
      ...artistItems(track, () => setUI({ nowPlayingOpen: false })),
      { sep: true },
      dislikedIds.has(track.id)
        ? { label: 'Вернуть трек (снять дизлайк)', icon: <ThumbDownFill size={14} />, onClick: () => undislike(track.id) }
        : { label: 'Больше не играть', icon: <ThumbDown size={14} />, onClick: () => dislike(track) },
      { label: 'Эквалайзер', icon: <Sliders size={14} />, onClick: () => setUI({ eqOpen: true }) },
    ] } });
  };

  return (
    <div className={`np2${playing ? '' : ' paused'}${immersive ? ' immersive' : ''}`} style={{ '--accent': accent }}>
      <div className="np2-bg">
        {coverSrc && <img className="a" src={coverSrc} alt="" crossOrigin="anonymous" />}
        {coverSrc && <img className="b" src={coverSrc} alt="" crossOrigin="anonymous" />}
        <div className="veil" />
        <div className="grain" />
      </div>

      <div className="np2-top">
        <div className="np2-ctx">
          <div>
            <div className="kind">{kind}</div>
            <div className="name">{context?.name || track.album}</div>
          </div>
        </div>
        <div className="np2-top-actions">
          <button className={`np2-icon${immersive ? ' on' : ''}`} title="Текст на весь экран" onClick={() => { setImmersive((v) => !v); setTab('lyrics'); }}>
            <MicIc size={16} />
          </button>
          <button className="np2-icon" title="Эквалайзер" onClick={() => setUI({ eqOpen: true })}><Sliders size={16} /></button>
          <button
            className={`np2-icon${sharing ? ' on' : ''}`}
            title={sharing || 'Поделиться треком: отдельная html-страница со звуком и текстом'}
            disabled={!!sharing}
            onClick={shareTrack}
            data-testid="np2-share"
          >
            <Share size={16} />
          </button>
          <button className="np2-icon" title="Ещё" onClick={openMore}><DotsH size={16} /></button>
          <button className="np2-icon" title="Свернуть (Esc)" onClick={() => setUI({ nowPlayingOpen: false })}><Collapse size={16} /></button>
        </div>
      </div>

      <div className={`np2-grid${immersive ? ' solo' : ''}`}>
        {!immersive && (
          <div className="np2-stage">
            <div className="np2-cover-wrap">
              <Cover id={track.coverArt || track.albumId} size={800} alt={track.album} className="np2-cover" />
            </div>

            <div className="np2-meta">
              <div className="np2-title-wrap">
                <div className="np2-title" title={track.title}>{track.title}</div>
                <div className="np2-artist">
                  <ArtistLinks as="span" item={track} onNavigate={() => setUI({ nowPlayingOpen: false })} />
                  {track.album && <> · <span onClick={() => { setUI({ nowPlayingOpen: false }); track.albumId && nav(`/album/${track.albumId}`); }}>{track.album}</span></>}
                </div>
                <div className="np2-tags">
                  {folder && (
                    <button
                      className="np2-tag folder"
                      title={`Музыкальная папка: ${folder.name} — показать только её`}
                      onClick={() => { setMusicFolder(folder.id); setUI({ nowPlayingOpen: false }); }}
                    >
                      <FolderIc size={11} /><span>{folder.name}</span>
                    </button>
                  )}
                  {track.year && <span className="np2-tag">{track.year}</span>}
                  {track.suffix && <span className="np2-tag">{String(track.suffix).toUpperCase()}</span>}
                  {track.bitRate ? <span className="np2-tag">{track.bitRate} кбит/с</span> : null}
                  {track.genre && <span className="np2-tag">{track.genre}</span>}
                  {isOff && <span className="np2-tag accent">офлайн</span>}
                </div>
              </div>
              <div className="np2-side-actions">
                <button className={`np2-icon${isStar ? ' on' : ''}`} title="В любимые" onClick={() => toggleStar(track, 'song')}>
                  {isStar ? <HeartFill size={16} /> : <Heart size={16} />}
                </button>
                <button
                  className={`np2-icon${isBanned ? ' on' : ''}`}
                  title={isBanned ? 'Вернуть трек' : 'Больше не играть (X)'}
                  onClick={() => toggleDislike(track)}
                >
                  {isBanned ? <ThumbDownFill size={16} /> : <ThumbDown size={16} />}
                </button>
                <button
                  className="np2-icon"
                  title="Добавить в плейлист"
                  onClick={() => setUI({ addToOpen: { ids: [track.id], title: `${track.title} — ${track.artist}` } })}
                >
                  <Plus size={17} />
                </button>
                <button className="np2-icon" title={isOff ? 'Доступен офлайн' : 'Скачать'} onClick={() => !isOff && download(track)}>
                  {isOff ? <Check size={16} /> : <Download size={16} />}
                </button>
              </div>
            </div>

            {settings.showVisualizer && <Visualizer accent={accent} />}

            <div className="np2-bar">
              <div className="np2-times">
                <span className="t">{fmt(time)}</span>
                <Slider value={time} max={total} onCommit={seek} />
                <span className="t">-{fmt(Math.max(0, total - time))}</span>
              </div>

              <div className="np2-controls">
                <button className={`np2-btn${shuffle ? ' on' : ''}`} title="Перемешать" onClick={toggleShuffle}><Shuffle size={20} /></button>
                <button className="np2-btn" title="Предыдущий" onClick={prev}><Prev size={26} /></button>
                <button className="np2-play" title={playing ? 'Пауза' : 'Играть'} onClick={togglePlay}>
                  {playing ? <Pause size={26} /> : <Play size={26} />}
                </button>
                <button className="np2-btn" title="Следующий" onClick={() => next(true)}><Next size={26} /></button>
                <button className={`np2-btn${repeat !== 'off' ? ' on' : ''}`} title="Повтор" onClick={cycleRepeat}>
                  {repeat === 'one' ? <RepeatOne size={20} /> : <Repeat size={20} />}
                </button>
              </div>

              <div className="np2-extra">
                <div className="np2-vol">
                  <button className="np2-btn" onClick={toggleMute} title="Звук"><VolIcon size={16} /></button>
                  <Slider value={vol} max={1} onChange={setVolume} bubble={volumeLabel} wheelStep={0.04} />
                </div>
                {nextTrack ? (
                  <button className="np2-next" onClick={() => useStore.getState().jumpTo(index + 1)} title="Следующий трек">
                    <Cover id={nextTrack.coverArt || nextTrack.albumId} size={80} alt="" />
                    <div className="l">
                      <small>Далее</small>
                      <div>{nextTrack.title} — {nextTrack.artist}</div>
                    </div>
                  </button>
                ) : (
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,.45)' }}>
                    {queue.length ? `${songsWord(queue.length)} в очереди` : ''}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="np2-panel">
          <div className="np2-tabs">
            <button className={`np2-tab${tab === 'lyrics' ? ' active' : ''}`} onClick={() => setTab('lyrics')}>Текст</button>
            <button className={`np2-tab${tab === 'queue' ? ' active' : ''}`} onClick={() => { setTab('queue'); setImmersive(false); }}>Очередь</button>
            <button className={`np2-tab${tab === 'artist' ? ' active' : ''}`} onClick={() => { setTab('artist'); setImmersive(false); }}>Об исполнителе</button>
            <div className="grow" />
            {tab === 'lyrics' && (
              <button className="np2-icon" title={immersive ? 'Обычный вид' : 'Развернуть текст'} onClick={() => setImmersive((v) => !v)}>
                {immersive ? <Collapse size={14} /> : <Expand size={14} />}
              </button>
            )}
          </div>

          <div className="np2-panel-body">
            {tab === 'lyrics' && <LyricsPane track={track} time={time} onSeek={seek} immersive={immersive} />}
            {tab === 'queue' && <QueuePane />}
            {tab === 'artist' && <ArtistPane track={track} onClose={() => setUI({ nowPlayingOpen: false })} />}
          </div>
        </div>
      </div>

      {immersive && (
        <div className="np2-dock">
          <Cover id={track.coverArt || track.albumId} size={120} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover' }} />
          <div style={{ minWidth: 0, flex: '0 0 220px' }}>
            <div style={{ fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title}</div>
            <ArtistLinks
              item={track}
              onNavigate={() => setUI({ nowPlayingOpen: false })}
              style={{ fontSize: 13, color: 'rgba(255,255,255,.65)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            />
          </div>
          <button className="np2-btn" onClick={prev}><Prev size={20} /></button>
          <button className="np2-play" style={{ width: 52, height: 52 }} onClick={togglePlay}>{playing ? <Pause size={20} /> : <Play size={20} />}</button>
          <button className="np2-btn" onClick={() => next(true)}><Next size={20} /></button>
          <span className="t" style={{ fontSize: 12, color: 'rgba(255,255,255,.6)', minWidth: 42 }}>{fmt(time)}</span>
          <Slider value={time} max={total} onCommit={seek} />
          <span className="t" style={{ fontSize: 12, color: 'rgba(255,255,255,.6)', minWidth: 42 }}>{fmt(total)}</span>
        </div>
      )}
    </div>
  );
}
