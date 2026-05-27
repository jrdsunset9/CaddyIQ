{ pkgs }: {
  deps = [
    pkgs.nodejs_20
    pkgs.ffmpeg
    pkgs.nodePackages.typescript
  ];
}
