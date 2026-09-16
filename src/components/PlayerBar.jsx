import React from 'react';
import { useNavigate } from 'react-router-dom';
import useStore from '../state/store';
import Splitter from './Splitter';
import { Cover, Slider } from './UI';
import { linkProps } from '../lib/uiA11y';
import {
  Play, Pause, Next, Prev, Shuffle, Repeat, RepeatOne, Heart, HeartFill,
  VolHigh, VolLow, VolMute, QueueIc, MicIc, Expand, Sliders, Download, Check, RadioIc,
  ThumbDown, ThumbDownFill, MiniIc, LayoutIc, FolderIc,
} from './Icons';
import { fmt } from '../lib/util';
import { volumeLabel } from '../lib/audio';
import ArtistLinks from './ArtistLinks';

export default function PlayerBar() {
  const nav = useNavigate();
  const {
    current, playing, togglePlay, next, prev, time, duration, seek,
    shuffle, toggleShuffle, repeat, cycleRepeat, settings, setVolume, toggleMute,
    toggleStar, starredIds, setUI, queueOpen, nowPlayingOpen, offline, download, buffering,
    toggleAutoDj, autodjBusy, toggleDislike, dislikedIds, enterMini, setMusicFolder,
  } = useStore();
  const dj = settings.autodj || {};

  const track = current();
  const vol = settings.muted ? 0 : settings.volume;
  const VolIcon = vol === 0 ? VolMute : vol < 0.5 ? VolLow : VolHigh;
  const isStar = track && starredIds.song.has(track.id);
  const isBanned = track && dislikedIds.has(track.id);
  const isOff = track && !!offline[track.id];
  // из какой музыкальной папки (библиотеки) этот трек
  const folder = useStore((st) => (st.showTrackFolder() ? st.folderOfTrack(track) : null));

  const ui = settings.ui || {};
  const show = (id) => !(ui.leftHidden || []).includes(id);

  /* правая группа кнопок: состав и порядок настраиваются в «Интерфейс и раскладка» */
  const rightBtns = {
    autodj: (
      <button
        className={`ghost-btn${dj.enabled ? ' on' : ''}${autodjBusy ? ' dj-busy' : ''}`}
        onClick={toggleAutoDj}
        title={dj.enabled ? 'AutoDJ включён — очередь продолжается сама (D)' : 'AutoDJ: бесконечная очередь (D)'}
      >
        <RadioIc size={16} />
      </button>
    ),
    lyrics: <button className="ghost-btn" onClick={() => setUI({ nowPlayingOpen: true })} title="Текст песни"><MicIc size={16} /></button>,
    queue: <button className={`ghost-btn${queueOpen ? ' on' : ''}`} onClick={() => setUI({ queueOpen: !queueOpen })} title="Очередь"><QueueIc size={16} /></button>,
    eq: <button className="ghost-btn" onClick={() => setUI({ eqOpen: true })} title="Эквалайзер"><Sliders size={16} /></button>,
    volume: (
      <>
        <button className="ghost-btn" onClick={toggleMute} title="Звук"><VolIcon size={16} /></button>
        <Slider className="vol" value={vol} max={1} onChange={setVolume} bubble={volumeLabel} wheelStep={0.04} label="Громкость" />
      </>
    ),
    mini: <button className="ghost-btn" onClick={enterMini} title="Мини-плеер: маленькое окно поверх других (Shift + M)"><MiniIc size={16} /></button>,
    expand: <button className="ghost-btn" onClick={() => setUI({ nowPlayingOpen: !nowPlayingOpen })} title="Во весь экран"><Expand size={16} /></button>,
    layout: <button className="ghost-btn" onClick={() => setUI({ layoutOpen: true })} title="Интерфейс и раскладка"><LayoutIc size={16} /></button>,
  };
  const order = (ui.barOrder && ui.barOrder.length ? ui.barOrder : Object.keys(rightBtns))
    .filter((id) => rightBtns[id] && !(ui.barHidden || []).includes(id));

  return (
    <div className="player">
      <Splitter
        axis="y" field="barH" min={68} max={150} dflt={88} dir={-1} className="on-top"
        title="Высота панели плеера: потяните мышью"
      />
      <div className="pl-left">
        {track ? (
          <>
            <Cover id={track.coverArt || track.albumId} size={120} alt={track.album} onClick={() => setUI({ nowPlayingOpen: true })} />
            <div className="meta">
              <div
                className="t"
                style={{ cursor: track.albumId ? 'pointer' : 'default' }}
                {...linkProps(() => { if (track.albumId) nav(`/album/${track.albumId}`); }, !!track.albumId)}
              >{track.title}</div>
              <ArtistLinks item={track} className="a" />
              {folder && (
                <button
                  className="pl-folder"
                  title={`Музыкальная папка: ${folder.name} — показать только её`}
                  onClick={() => setMusicFolder(folder.id)}
                >
                  <FolderIc size={10} /><span>{folder.name}</span>
                </button>
              )}
            </div>
            {show('like') && (
              <button className={`ghost-btn${isStar ? ' on' : ''}`} onClick={() => toggleStar(track, 'song')} title="В любимые" style={{ marginLeft: 8 }}>
                {isStar ? <HeartFill size={16} /> : <Heart size={16} />}
              </button>
            )}
            {show('dislike') && (
              <button
                className={`ghost-btn${isBanned ? ' on danger' : ''}`}
                onClick={() => toggleDislike(track)}
                title={isBanned ? 'Дизлайк стоит — вернуть трек (X)' : 'Больше не играть этот трек (X)'}
              >
                {isBanned ? <ThumbDownFill size={16} /> : <ThumbDown size={16} />}
              </button>
            )}
            {show('download') && (
              <button className="ghost-btn" onClick={() => (isOff ? null : download(track))} title={isOff ? 'Доступен офлайн' : 'Скачать'}>
                {isOff ? <span className="dl-dot"><Check size={9} /></span> : <Download size={16} />}
              </button>
            )}
          </>
        ) : (
          <div className="muted" style={{ paddingLeft: 8 }}>Ничего не играет</div>
        )}
      </div>

      <div className="pl-center">
        <div className="pl-controls">
          <button className={`ghost-btn${shuffle ? ' on' : ''}`} onClick={toggleShuffle} title="Перемешать"><Shuffle size={16} /></button>
          <button className="ghost-btn" onClick={prev} title="Предыдущий"><Prev size={16} /></button>
          <button className="pl-play" onClick={togglePlay} title={playing ? 'Пауза' : 'Играть'}>
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button className="ghost-btn" onClick={() => next(true)} title="Следующий"><Next size={16} /></button>
          <button className={`ghost-btn${repeat !== 'off' ? ' on' : ''}`} onClick={cycleRepeat} title={`Повтор: ${repeat === 'off' ? 'выкл' : repeat === 'all' ? 'всё' : 'трек'}`}>
            {repeat === 'one' ? <RepeatOne size={16} /> : <Repeat size={16} />}
          </button>
        </div>
        <div className="pl-progress">
          <span className="time">{fmt(time)}</span>
          <Slider value={time} max={duration || track?.duration || 0} onCommit={seek} />
          <span className="time">{buffering ? '…' : fmt(duration || track?.duration || 0)}</span>
        </div>
      </div>

      <div className="pl-right">
        {order.map((id) => <React.Fragment key={id}>{rightBtns[id]}</React.Fragment>)}
      </div>
    </div>
  );
}
