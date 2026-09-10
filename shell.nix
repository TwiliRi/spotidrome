# Точка входа для nix-shell.
#
#   nix-shell              — окружение разработки (Electron из nixpkgs)
#   nix-shell -A fhs       — FHS-окружение, в нём работает electron-builder
#   nix-build -A app       — собрать приложение (то же, что nix build .#spotidrome)
{ pkgs ? import <nixpkgs> { } }:
let shells = import ./nix/shells.nix { inherit pkgs; };
in shells.shell // {
  # .env — то, во что умеет входить nix-shell (сам buildFHSEnv — это программа)
  fhs = shells.fhs.env;
  # запускаемая оболочка: nix-build -A fhsEnv && ./result/bin/spotidrome-fhs
  fhsEnv = shells.fhs;
  app = pkgs.callPackage ./nix/package.nix { };
}
