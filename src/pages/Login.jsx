import React, { useState } from 'react';
import useStore from '../state/store';
import { normalizeServerUrl } from '../lib/api';
import { Logo } from '../components/Icons';

export default function Login() {
  const connect = useStore((s) => s.connect);
  const connecting = useStore((s) => s.connecting);
  const authError = useStore((s) => s.authError);
  const [url, setUrl] = useState('http://localhost:4533');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const base = normalizeServerUrl(url);

  const submit = (e) => {
    e.preventDefault();
    setUrl(base);
    connect({ url: base, username: username.trim(), password });
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div style={{ display: 'grid', placeItems: 'center' }}>
          <span className="logo" style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--green)', display: 'grid', placeItems: 'center', color: '#000' }}>
            <Logo size={40} />
          </span>
        </div>
        <h1>Spotidrome</h1>
        <p className="sub">Войдите в свой сервер Navidrome</p>

        {authError && <div className="error-box">{authError}</div>}

        <div className="field">
          <label>Адрес сервера</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => base && setUrl(base)}
            placeholder="https://music.example.com"
            spellCheck={false}
          />
          {base && base !== url.trim() && (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>
              Будет использован адрес: <span style={{ color: 'var(--green)' }}>{base}</span>
            </div>
          )}
        </div>
        <div className="field">
          <label>Пользователь</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" spellCheck={false} />
        </div>
        <div className="field">
          <label>Пароль</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>

        <button className="btn-primary" type="submit" disabled={connecting || !url || !username}>
          {connecting ? 'Подключаюсь…' : 'Войти'}
        </button>
        <button type="button" className="btn-ghost" onClick={() => connect({ demo: true, username: 'demo' })}>
          Посмотреть демо-библиотеку
        </button>

        <div className="login-note">
          Пароль хранится локально и передаётся по схеме Subsonic (соль + MD5-токен),
          в открытом виде по сети не уходит.
        </div>
      </form>
    </div>
  );
}
