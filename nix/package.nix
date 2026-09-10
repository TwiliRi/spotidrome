# Настоящий Nix-пакет: ничего не скачивается во время сборки, Electron берётся
# из nixpkgs, на выходе — обычный исполняемый файл и .desktop-запись.
#
#   nix build .#spotidrome && ./result/bin/spotidrome
#
# npmDepsHash получается так: подставить lib.fakeHash, запустить сборку и
# скопировать правильный хеш из сообщения об ошибке.

{ lib
, buildNpmPackage
, electron
, makeWrapper
, copyDesktopItems
, makeDesktopItem
, python3
, pkg-config
}:

buildNpmPackage rec {
  pname = "spotidrome";
  version = "1.0.0";

  # в store не тащим node_modules/dist/release — иначе сборка станет неповторимой
  src = lib.cleanSourceWith {
    src = ../.;
    filter = path: type:
      let base = baseNameOf (toString path); in
      !(builtins.elem base [ "node_modules" "dist" "release" ".cache" "result" ]);
  };

  # Хеш зависимостей из package-lock.json. Меняется вместе с ним; чтобы получить
  # новый — подставьте lib.fakeHash, запустите сборку и скопируйте хеш из ошибки.
  npmDepsHash = "sha256-ZzX45/TrybLosWf8GqcS1m9xgkt1I+8MclS8RcVO03E=";

  nativeBuildInputs = [ makeWrapper copyDesktopItems python3 pkg-config ];

  # Electron из npm не нужен — он всё равно не запустится вне FHS
  env.ELECTRON_SKIP_BINARY_DOWNLOAD = "1";

  # vite build → dist/
  npmBuildScript = "build";

  installPhase = ''
    runHook preInstall

    # оставляем только прод-зависимости (mpris-service и т.п.)
    npm prune --omit=dev --ignore-scripts

    mkdir -p $out/share/spotidrome
    cp -r dist electron package.json node_modules $out/share/spotidrome/

    makeWrapper ${electron}/bin/electron $out/bin/spotidrome \
      --add-flags $out/share/spotidrome \
      --inherit-argv0

    install -Dm644 assets/icon.png \
      $out/share/icons/hicolor/1024x1024/apps/spotidrome.png

    runHook postInstall
  '';

  desktopItems = [
    (makeDesktopItem {
      name = "spotidrome";
      exec = "spotidrome";
      icon = "spotidrome";
      desktopName = "Spotidrome";
      comment = "Клиент Navidrome в стиле Spotify";
      categories = [ "Audio" "AudioVideo" "Player" ];
      startupWMClass = "Spotidrome";
    })
  ];

  meta = {
    description = "Spotify-подобный десктоп-клиент для Navidrome";
    mainProgram = "spotidrome";
    platforms = lib.platforms.linux;
    license = lib.licenses.mit;
  };
}
