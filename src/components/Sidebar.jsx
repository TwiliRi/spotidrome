import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import useStore from '../state/store';
import Splitter from './Splitter';
import api from '../lib/api';
import usePlaylistDnd from '../lib/usePlaylistDnd';
import { Cover } from './UI';
import {
  Search, Library, LibraryFill, Plus, HeartFill, Download, ThumbDownFill, Clock,
  ChevronLeft, ChevronRight, Expand as ExpandIc, PinIc, PinFillIc, QueueIc, Trash, SyncIc,
} from './Icons';
import { songsWord, plural } from '../lib/util';

const FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'playlists', label: 'Плейлисты', hint: 'Мои плейлисты' },
  { id: 'shared', label: 'Общие', hint: 'Плейлисты других пользователей' },
  { id: 'albums', label: 'Альбомы' },
  { id: 'artists', label: 'Исполнители' },
];

/* Заголовки групп в списке медиатеки */
const GROUPS = {
  pinned: 'Закреплённое',
  playlists: 'Мои плейлисты',
  shared: 'Общие плейлисты',
  albums: 'Альбомы',
  artists: 'Исполнители',
};

/* Обложка элемента медиатеки: закреплённые списки со своими градиентами */
function ItemArt({ it, size = 100 }) {
  if (it.kind === 'liked') {
    return (
      <div className="ph" style={{ display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#450af5,#c4efd9)' }}>
        <HeartFill size={20} />
      </div>
    );
  }
  if (it.kind === 'recent') {
    return (
      <div className="ph" style={{ display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#1f3b57,#8fd3f4)' }}>
        <Clock size={18} />
      </div>
    );
  }
  if (it.kind === 'disliked') {
    return (
      <div className="ph" style={{ display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#7a1f2b,#2b2b2b)' }}>
        <ThumbDownFill size={18} />
      </div>
    );
  }
  if (it.kind === 'offline') {
    return (
      <div className="ph" style={{ display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#1db954,#0a4d24)' }}>
        <Download size={18} />
      </div>
    );
  }
  return <Cover id={it.coverArt} size={size} alt={it.name} round={it.round} />;
}

export default function Sidebar() {
  const nav = useNavigate();
  const loc = useLocation();
  // точечные подписки: список медиатеки большой, перерисовывать его каждый
  // такт воспроизведения незачем
  const playlists = useStore((s) => s.playlists);
  const loadPlaylists = useStore((s) => s.loadPlaylists);
  const toast = useStore((s) => s.toast);
  const offline = useStore((s) => s.offline);
  const libraryVersion = useStore((s) => s.libraryVersion);
  const setUI = useStore((s) => s.setUI);
  const addToQueue = useStore((s) => s.addToQueue);
  const orderPlaylists = useStore((s) => s.orderPlaylists);
  const movePlaylist = useStore((s) => s.movePlaylist);
  const resetPlaylistOrder = useStore((s) => s.resetPlaylistOrder);
  const playlistOrder = useStore((st) => st.settings.playlistOrder);
  const pins = useStore((st) => st.settings.pins);
  const dislikedCount = useStore((st) => st.dislikedIds.size);
  const playCount = useStore((st) => st.playHistory.length);
  const side = useStore((st) => st.settings.ui.sidebarSide);
  const collapsed = useStore((st) => !!st.settings.ui.sidebarCollapsed);
  const toggleSidebar = useStore((st) => st.toggleSidebar);
  const [tip, setTip] = useState(null);          // всплывающая подпись у свёрнутой полосы
  const [filter, setFilter] = useState('all');
  const [albums, setAlbums] = useState([]);
  const [artists, setArtists] = useState([]);
  const [q, setQ] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    loadPlaylists();
    api.albumList('starred', 50).then(setAlbums).catch(() => {});
    api.getArtists().then((a) => setArtists(a.slice(0, 40))).catch(() => {});
  }, [loadPlaylists, libraryVersion]);

  const items = useMemo(() => {
    const st = useStore.getState();
    const { mine, shared } = st.splitPlaylists(playlists);
    let list = [];

    if (filter === 'all' || filter === 'playlists') {
      list.push({ id: '__liked', kind: 'liked', group: 'playlists', name: 'Любимые треки', sub: 'Плейлист • ваши лайки', to: '/liked', fixed: true });
      list.push({
        id: '__recent', kind: 'recent', group: 'playlists', name: 'Недавнее', to: '/recent', fixed: true,
        sub: playCount ? `История • ${plural(playCount, 'запись', 'записи', 'записей')}` : 'История прослушиваний',
      });
      if (dislikedCount) {
        list.push({ id: '__disliked', kind: 'disliked', group: 'playlists', name: 'Исключённые треки', sub: `Локально • ${songsWord(dislikedCount)}`, to: '/disliked', fixed: true });
      }
      if (Object.keys(offline).length) {
        list.push({ id: '__offline', kind: 'offline', group: 'playlists', name: 'Офлайн', sub: `Загружено • ${songsWord(Object.keys(offline).length)}`, to: '/offline', fixed: true });
      }
      // свой порядок (перетаскиванием) важнее того, что прислал сервер
      list = list.concat(st.orderPlaylists(mine).map((p) => ({
        id: p.id, kind: 'playlist', group: 'playlists', name: p.name, coverArt: p.coverArt || p.id,
        sub: `Плейлист • ${p.public ? 'открыт всем' : 'только я'}`, to: `/playlist/${p.id}`, pl: p,
      })));
    }
    if (filter === 'all' || filter === 'shared') {
      // плейлисты других пользователей Navidrome: читаем, но не редактируем
      list = list.concat(st.orderPlaylists(shared).map((p) => ({
        id: p.id, kind: 'playlist', group: 'shared', name: p.name, coverArt: p.coverArt || p.id,
        sub: `Общий плейлист • ${p.owner}`, to: `/playlist/${p.id}`, pl: p, shared: true,
      })));
    }
    if (filter === 'all' || filter === 'albums') {
      list = list.concat(albums.map((a) => ({
        id: a.id, kind: 'album', group: 'albums', name: a.name, coverArt: a.coverArt || a.id,
        sub: `Альбом • ${a.artist}`, to: `/album/${a.id}`,
      })));
    }
    if (filter === 'all' || filter === 'artists') {
      list = list.concat(artists.map((a) => ({
        id: a.id, kind: 'artist', group: 'artists', name: a.name, coverArt: a.coverArt || a.id,
        sub: 'Исполнитель', to: `/artist/${a.id}`, round: true,
      })));
    }
    if (q.trim()) {
      const s2 = q.toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(s2));
    }

    // закреплённое поднимаем наверх отдельной группой, в порядке закрепления
    list.forEach((i) => { i.pinned = !i.fixed && st.isPinned(i.kind, i.id); });
    const pinnedItems = list.filter((i) => i.pinned)
      .sort((a, b) => st.pinIndex(a.kind, a.id) - st.pinIndex(b.kind, b.id))
      .map((i) => ({ ...i, group: 'pinned' }));
    return [...pinnedItems, ...list.filter((i) => !i.pinned)];
  }, [filter, playlists, albums, artists, q, offline, dislikedCount, pins, playCount, playlistOrder, orderPlaylists]);

  /* ------------------ перетаскивание плейлистов ------------------
     Порядок хранится локально (settings.playlistOrder) и применяется везде,
     где плейлисты показываются списком. Закреплённые строки переставляются
     внутри своей группы — там порядок задают закрепления (settings.pins). */
  const { drag, dndProps, dndClass } = usePlaylistDnd({ axis: 'y' });

  /* Меню по правому клику: закрепить, отправить в очередь, удалить */
  const rowMenu = (e, it) => {
    e.preventDefault();
    e.stopPropagation();
    const st = useStore.getState();
    const pinned = st.isPinned(it.kind, it.id);
    const items2 = [
      { label: 'Открыть', onClick: () => nav(it.to) },
      !it.fixed && {
        label: pinned ? 'Открепить' : 'Закрепить вверху',
        icon: pinned ? <PinFillIc size={14} /> : <PinIc size={14} />,
        onClick: () => st.togglePin(it.kind, it.id, it.name),
      },
      it.kind === 'playlist' && { sep: true },
      it.kind === 'playlist' && {
        label: 'Добавить в очередь',
        icon: <QueueIc size={14} />,
        onClick: async () => {
          try {
            const { songs } = await api.getPlaylist(it.id);
            addToQueue(songs);
          } catch (err) { toast('Не удалось прочитать плейлист', 'error'); }
        },
      },
      it.kind === 'playlist' && !it.shared && {
        label: 'Удалить плейлист',
        icon: <Trash size={14} />,
        danger: true,
        onClick: async () => {
          try {
            await api.deletePlaylist(it.id);
            await loadPlaylists();
            toast('Плейлист удалён', 'success');
            if (loc.pathname === it.to) nav('/library?tab=playlists');
          } catch (err) { toast('Не удалось удалить: ' + err.message, 'error'); }
        },
      },
      it.shared && { label: 'Общий плейлист — только чтение', header: true },
      // порядок плейлистов — локальный, поэтому его всегда можно откатить
      (playlistOrder || []).length && { sep: true },
      (playlistOrder || []).length && {
        label: 'Сбросить порядок плейлистов',
        icon: <SyncIc size={14} />,
        onClick: () => resetPlaylistOrder(),
      },
    ];
    setUI({ contextMenu: { x: e.clientX, y: e.clientY, items: items2 } });
  };

  const createPlaylist = async () => {
    const name = `Мой плейлист №${playlists.length + 1}`;
    try {
      const pl = await api.createPlaylist(name);
      await loadPlaylists();
      toast('Плейлист создан', 'success');
      if (pl?.id) nav(`/playlist/${pl.id}`);
    } catch (e) { toast('Не удалось создать плейлист: ' + e.message, 'error'); }
  };

  const Collapse = side === 'right' ? ChevronRight : ChevronLeft;
  const Unfold = side === 'right' ? ChevronLeft : ChevronRight;

  /* ------------------------- свёрнутая полоса ------------------------- */
  if (collapsed) {
    const showTip = (e, it) => {
      const r = e.currentTarget.getBoundingClientRect();
      setTip({ top: r.top + r.height / 2, left: side === 'right' ? r.left - 12 : r.right + 12, it });
    };
    return (
      <aside className="sidebar rail">
        <Splitter
          axis="x" field="sidebarW" min={170} max={480} dflt={260}
          dir={side === 'right' ? -1 : 1}
          className={side === 'right' ? 'on-left' : 'on-right'}
          collapse={{ at: 150, isCollapsed: true, onCollapse: (v) => toggleSidebar(v) }}
          title="Потяните, чтобы развернуть медиатеку"
        />
        <div className="side-block side-lib rail-block">
          <button
            className="rail-head"
            onClick={() => toggleSidebar(false)}
            title="Развернуть медиатеку (Ctrl + B)"
          >
            <span className="rail-head-ic">
              {loc.pathname === '/library' ? <LibraryFill size={24} /> : <Library size={24} />}
            </span>
            <span className="rail-head-arrow"><Unfold size={13} /></span>
          </button>

          <div className={`rail-list${drag ? ' dnd-on' : ''}`} onMouseLeave={() => setTip(null)}>
            {items.map((it, i) => (
              <React.Fragment key={it.kind + it.id}>
                {/* тонкая черта там, где начинается новая группа */}
                {i > 0 && items[i - 1].group !== it.group && <span className="rail-sep" />}
                <button
                  className={`rail-item${loc.pathname === it.to ? ' active' : ''}${it.round ? ' round' : ''} ${dndClass(it)}`.trim()}
                  onClick={() => { nav(it.to); setTip(null); }}
                  onContextMenu={(e) => { setTip(null); rowMenu(e, it); }}
                  {...dndProps(it)}
                  onMouseEnter={(e) => showTip(e, it)}
                  onFocus={(e) => showTip(e, it)}
                  onBlur={() => setTip(null)}
                >
                  <ItemArt it={it} size={100} />
                  {it.pinned && <span className="pin-badge"><PinFillIc size={9} /></span>}
                  {it.shared && <span className="shared-badge" title="Общий плейлист" />}
                </button>
              </React.Fragment>
            ))}
          </div>

          <button className="rail-add" title="Создать плейлист" onClick={createPlaylist}>
            <Plus size={18} />
          </button>
        </div>

        {tip && (
          <div
            className={`rail-tip${side === 'right' ? ' left' : ''}`}
            style={{ top: tip.top, left: tip.left }}
          >
            <b>{tip.it.name}{tip.it.pinned ? ' 📌' : ''}</b>
            <i>{tip.it.sub}</i>
          </div>
        )}
      </aside>
    );
  }

  /* --------------------------- обычный вид --------------------------- */
  return (
    <aside className="sidebar">
      <Splitter
        axis="x" field="sidebarW" min={170} max={480} dflt={260}
        dir={side === 'right' ? -1 : 1}
        className={side === 'right' ? 'on-left' : 'on-right'}
        collapse={{ at: 150, isCollapsed: false, onCollapse: (v) => toggleSidebar(v) }}
        title="Ширина медиатеки: потяните мышью (до упора — свернётся в полосу)"
      />
      <div className="side-block side-lib">
        <div className="lib-head">
          {/* как в Spotify: клик по «Моей медиатеке» сворачивает панель в полосу */}
          <button
            className="lib-title"
            onClick={() => toggleSidebar(true)}
            title="Свернуть медиатеку (Ctrl + B)"
          >
            <span className="lib-title-ic">
              {loc.pathname === '/library' ? <LibraryFill size={24} /> : <Library size={24} />}
              <span className="lib-title-arrow"><Collapse size={11} /></span>
            </span>
            <span>Моя медиатека</span>
          </button>
          <div className="lib-actions">
            <button className="icon-btn" title="Найти в медиатеке" onClick={() => setShowSearch((v) => !v)}><Search size={16} /></button>
            <button className="icon-btn" title="Создать плейлист" onClick={createPlaylist}><Plus size={16} /></button>
            <button className="icon-btn" title="Открыть всю медиатеку" onClick={() => nav('/library')}><ExpandIc size={15} /></button>
          </div>
        </div>

        <div className="chips">
          {FILTERS.map((f) => (
            <button key={f.id} title={f.hint || f.label} className={`chip${filter === f.id ? ' active' : ''}`} onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>

        {showSearch && (
          <div style={{ padding: '0 12px 8px' }}>
            <div className="search-box" style={{ width: '100%', padding: '7px 12px' }}>
              <Search size={14} />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск в медиатеке" />
            </div>
          </div>
        )}

        <div className={`lib-list${drag ? ' dnd-on' : ''}`}>
          {items.map((it, i) => (
            <React.Fragment key={it.kind + it.id}>
              {(i === 0 || items[i - 1].group !== it.group) && (
                <div className="lib-group">
                  {it.group === 'pinned' && <PinFillIc size={10} />}
                  <span>{GROUPS[it.group]}</span>
                </div>
              )}
              <button
                className={`lib-row${loc.pathname === it.to ? ' active' : ''} ${dndClass(it)}`.trim()}
                onClick={() => nav(it.to)}
                onContextMenu={(e) => rowMenu(e, it)}
                {...dndProps(it)}
              >
                <ItemArt it={it} size={100} />
                <div className="meta">
                  <div className="name"><span className="t">{it.name}</span></div>
                  <div className="sub">{it.sub}</div>
                </div>
                {!it.fixed && (
                  <span
                    className={`lib-pin${it.pinned ? ' on' : ''}`}
                    title={it.pinned ? 'Открепить' : 'Закрепить вверху'}
                    onClick={(e) => { e.stopPropagation(); useStore.getState().togglePin(it.kind, it.id, it.name); }}
                  >
                    {it.pinned ? <PinFillIc size={13} /> : <PinIc size={13} />}
                  </span>
                )}
              </button>
            </React.Fragment>
          ))}
          {!items.length && (
            <div className="muted" style={{ padding: 16, fontSize: 13, lineHeight: 1.6 }}>
              Ничего не найдено. Создайте плейлист или добавьте альбомы в любимые.
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
