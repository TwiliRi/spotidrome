{
  description = "Spotidrome — Spotify-подобный десктоп-клиент для Navidrome";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f (import nixpkgs { inherit system; }));
    in
    {
      # nix develop            — окружение разработки
      # nix develop .#fhs      — FHS-окружение для electron-builder
      devShells = forAll (pkgs:
        let shells = import ./nix/shells.nix { inherit pkgs; };
        in {
          default = shells.shell;
          fhs = shells.fhs.env;
        });

      # nix build  /  nix run
      packages = forAll (pkgs: rec {
        spotidrome = pkgs.callPackage ./nix/package.nix { };
        # запускаемое FHS-окружение: nix run .#fhs -- -c "npm run dist:linux"
        fhs = (import ./nix/shells.nix { inherit pkgs; }).fhs;
        default = spotidrome;
      });

      apps = forAll (pkgs: rec {
        spotidrome = {
          type = "app";
          program = "${self.packages.${pkgs.stdenv.hostPlatform.system}.spotidrome}/bin/spotidrome";
        };
        fhs = {
          type = "app";
          program = "${self.packages.${pkgs.stdenv.hostPlatform.system}.fhs}/bin/spotidrome-fhs";
        };
        default = spotidrome;
      });

      formatter = forAll (pkgs: pkgs.nixpkgs-fmt);
    };
}
