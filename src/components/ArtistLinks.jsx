import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { artistTokens, resolveArtistTokens, resolveArtistId } from '../lib/artists';
import { bannedKeys, isBannedArtist } from '../lib/banned.js';
import useStore from '../state/store';
import { Ban, Check } from './Icons';

const displayOf = (item) => String(item?.displayArtist || item?.artist || item?.name || '');
const idOf = (item) => (item ? `${item.artistId || ''}|${displayOf(item)}|${item.artists?.length || 0}` : '');

/**
 * Токены исполнителей: сразу отдаёт разбор строки, а затем уточняет его
 * по данным сервера (кому какой id принадлежит и не один ли это коллектив).
 */
export function useArtistTokens(item) {
  const ck = idOf(item);
  const [tokens, setTokens] = useState(() => artistTokens(item));

  useEffect(() => {
    let alive = true;
    setTokens(artistTokens(item));
    resolveArtistTokens(item)
      .then((t) => { if (alive && t && t.length) setTokens(t); })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ck]);

  return tokens;
}

/** Плоский список исполнителей (с уточнением по серверу). */
export function useArtistList(item) {
  const tokens = useArtistTokens(item);
  return useMemo(() => tokens.filter((t) => t.type === 'artist').map((t) => ({ id: t.id || null, name: t.name })), [tokens]);
}

/** Переход к исполнителю: по id, иначе ищем по имени, иначе — по всей подписи, иначе в поиск. */
export function useArtistNav(before) {
  const nav = useNavigate();
  return useCallback(async (entry, item) => {
    before?.();
    const name = typeof entry === 'string' ? entry : entry?.name;
    const id = typeof entry === 'string' ? null : entry?.id;
    if (id) { nav(`/artist/${id}`); return; }
    if (!name) return;

    const found = await resolveArtistId(name);
    if (found) { nav(`/artist/${found}`); return; }

    // имя не нашлось: возможно, строку разрезали зря («Simon & Garfunkel»)
    const whole = item ? displayOf(item) : '';
    if (whole && whole.toLowerCase() !== name.toLowerCase()) {
      const wholeId = item.artistId || await resolveArtistId(whole);
      if (wholeId) { nav(`/artist/${wholeId}`); return; }
    }
    nav(`/search?q=${encodeURIComponent(name)}`);
  }, [nav, before]);
}

/**
 * Кликабельный список исполнителей: каждое имя ведёт к своему артисту,
 * разделители («, », « feat. », « & ») остаются обычным текстом.
 */
export default function ArtistLinks({
  item, className = '', style, onNavigate, as: Tag = 'div', stopPropagation = true,
}) {
  const tokens = useArtistTokens(item);
  const go = useArtistNav(onNavigate);
  if (!tokens.length) return null;

  return (
    <Tag className={`artist-links ${className}`.trim()} style={style} title={tokens.map((t) => (t.type === 'sep' ? t.text : t.name)).join('')}>
      {tokens.map((t, i) => (t.type === 'sep'
        ? <span className="sep" key={i}>{t.text}</span>
        : (
          <span
            className="lnk"
            key={i}
            role="link"
            tabIndex={0}
            onClick={(e) => { if (stopPropagation) e.stopPropagation(); go(t, item); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(t, item); } }}
          >
            {t.name}
          </span>
        )))}
    </Tag>
  );
}

/**
 * Пункты контекстного меню: переход к исполнителю и блокировка.
 * Бан — «чтобы не попадался»: треки такого исполнителя перестают приходить
 * в AutoDJ, радио и случайном выборе, а по настройке и вовсе прячутся.
 */
export function useArtistMenuItems() {
  const nav = useNavigate();
  const bannedList = useStore((s) => s.settings.bannedArtists);
  const toggleArtistBan = useStore((s) => s.toggleArtistBan);
  return useCallback((item, before) => {
    const list = artistTokens(item).filter((t) => t.type === 'artist');
    if (!list.length) return [];
    const keys = bannedKeys(bannedList || []);
    const banItem = (a) => {
      const on = isBannedArtist(keys, a);
      return {
        label: `${on ? 'Разблокировать' : 'Заблокировать'}: ${a.name}`,
        icon: on ? <Check size={14} /> : <Ban size={14} />,
        danger: !on,
        onClick: () => toggleArtistBan({ id: a.id || null, name: a.name }),
      };
    };

    const open = async (a) => {
      before?.();
      if (a.id) { nav(`/artist/${a.id}`); return; }
      const found = await resolveArtistId(a.name);
      if (found) { nav(`/artist/${found}`); return; }
      const whole = displayOf(item);
      const wholeId = item?.artistId || (whole ? await resolveArtistId(whole) : null);
      nav(wholeId ? `/artist/${wholeId}` : `/search?q=${encodeURIComponent(a.name)}`);
    };

    if (list.length === 1) {
      return [
        { label: 'Перейти к исполнителю', onClick: () => open(list[0]) },
        banItem(list[0]),
      ];
    }
    return [
      { label: 'Перейти к исполнителю', header: true },
      ...list.map((a) => ({ label: a.name, onClick: () => open(a) })),
      { sep: true },
      { label: 'Заблокировать исполнителя', header: true },
      ...list.map(banItem),
    ];
  }, [nav, bannedList, toggleArtistBan]);
}
