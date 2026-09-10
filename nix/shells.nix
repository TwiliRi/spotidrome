# Dev-окружение для NixOS: nix-shell
#
#   nix-shell            # войти в окружение
#   npm install          # без скачивания бинарника Electron
#   npm run dev          # только фронтенд, http://localhost:5173
#   npm run start:nix    # Vite + Electron из nixpkgs
#
# Главная особенность NixOS: скачанные npm-бинарники (electron, app-builder,
# appimagetool) собраны под FHS и не найдут /lib64/ld-linux-x86-64.so.2.
# Поэтому Electron берём из nixpkgs, а сборку установщиков делаем в FHS-окружении
# (см. flake.nix, devShell `fhs`, или `nix-shell -A fhs`).

{ pkgs ? import <nixpkgs> { } }:

let
  electron = pkgs.electron;

  common = {
    # npm не должен тянуть свой Electron — он не запустится вне FHS
    ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
    # electron-builder возьмёт распакованный Electron отсюда
    ELECTRON_OVERRIDE_DIST_PATH = "${electron}/libexec/electron";
    # используется скриптом npm run start:nix
    ELECTRON_BIN = "${electron}/bin/electron";
  };

  fhs = pkgs.buildFHSEnv {
    name = "spotidrome-fhs";
    # внутри — привычный /usr/lib, поэтому скачанные бинарники работают
    targetPkgs = p: (with p; [
      nodejs_22
      python3
      git
      # инструменты electron-builder
      fakeroot
      dpkg
      binutils # fpm зовёт ar при сборке .deb
      rpm
      zip
      unzip
      p7zip
      fuse
      # mksquashfs/appimagetool линкуются с этими библиотеками
      zlib
      xz
      lz4
      zstd
      bzip2
      # рантайм Chromium/Electron
      alsa-lib
      at-spi2-atk
      at-spi2-core
      atk
      cairo
      cups
      dbus
      expat
      gdk-pixbuf
      glib
      gtk3
      libdrm
      libnotify
      libsecret
      libxkbcommon
      nspr
      nss
      pango
      udev
    ]) ++ [
      # ruby внутри fpm (сборка .deb/.rpm) требует старый libcrypt.so.1
      (p.libxcrypt-legacy or p.libxcrypt)
      # библиотеки X переезжают из набора xorg в верхний уровень —
      # берём совместимо со старыми и новыми nixpkgs
      (p.libx11 or p.xorg.libX11)
      (p.libxcomposite or p.xorg.libXcomposite)
      (p.libxdamage or p.xorg.libXdamage)
      (p.libxext or p.xorg.libXext)
      (p.libxfixes or p.xorg.libXfixes)
      (p.libxrandr or p.xorg.libXrandr)
      (p.libxtst or p.xorg.libXtst)
      (p.libxcb or p.xorg.libxcb)
      (p.libxshmfence or p.xorg.libxshmfence)
    ];
    runScript = "bash";
    profile = ''
      export ELECTRON_BUILDER_CACHE="$PWD/.cache/electron-builder"
      echo "FHS-окружение: тут работают скачанные бинарники."
      echo "  npm install && npm run dist:linux   — AppImage, deb, tar.gz"
    '';
  };
in
{
  # nix-shell            — обычная разработка
  shell = pkgs.mkShell (common // {
    packages = with pkgs; [
      nodejs_22
      python3
      electron
      # пригодятся при упаковке через FHS
      dpkg
      fakeroot
      p7zip
    ];

    shellHook = ''
      echo "Spotidrome · node $(node -v) · electron из nixpkgs"
      echo "  npm install        (ELECTRON_SKIP_BINARY_DOWNLOAD=1 уже выставлен)"
      echo "  npm run dev        — фронтенд в браузере"
      echo "  npm run start:nix  — Vite + Electron"
    '';
  });

  # nix-shell -A fhs     — сборка установщиков electron-builder'ом
  inherit fhs;
}
