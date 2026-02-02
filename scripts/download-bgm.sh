#!/usr/bin/env bash
# BGM 下载脚本
# 国内用户：Mixkit 可能无法访问，请从 Pixabay 中文 https://pixabay.com/zh/music/ 下载 MP3 后放入 public/bgm/，详见 public/bgm/README.md
# 海外用户：可运行本脚本从 Mixkit 拉取示例 BGM（需网络可访问 assets.mixkit.co）
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
BGM="$DIR/public/bgm"
mkdir -p "$BGM"
cd "$BGM"

download() { local id=$1 url=$2; echo "Downloading $id ..."; curl -fsSL -o "${id}.mp3" "$url" || true; }

download classical 'https://assets.mixkit.co/music/preview/mixkit-piano-reflections-21.mp3'
download sad        'https://assets.mixkit.co/music/preview/mixkit-slow-trail-744.mp3'
download cinematic  'https://assets.mixkit.co/music/preview/mixkit-cinematic-mystery-trailer-216.mp3'
download epic       'https://assets.mixkit.co/music/preview/mixkit-valley-of-the-kings-395.mp3'
download ambient    'https://assets.mixkit.co/music/preview/mixkit-forest-sounds-with-birds-1249.mp3'
download meditation 'https://assets.mixkit.co/music/preview/mixkit-serene-view-443.mp3'
download upbeat     'https://assets.mixkit.co/music/preview/mixkit-tech-house-vibes-130.mp3'
download cyber      'https://assets.mixkit.co/music/preview/mixkit-deep-urban-623.mp3'
download corporate  'https://assets.mixkit.co/music/preview/mixkit-driving-ambition-32.mp3'
download jazz       'https://assets.mixkit.co/music/preview/mixkit-jazz-piano-bar-64.mp3'
download lofi       'https://assets.mixkit.co/music/preview/mixkit-sleepy-cat-135.mp3'
download happy      'https://assets.mixkit.co/music/preview/mixkit-life-is-a-dream-837.mp3'
download funk       'https://assets.mixkit.co/music/preview/mixkit-funky-one-252.mp3'
download rock       'https://assets.mixkit.co/music/preview/mixkit-complicated-281.mp3'
download horror     'https://assets.mixkit.co/music/preview/mixkit-horror-tales-563.mp3'

echo "Done. BGM files in: $BGM"
echo "若部分文件未下载成功（如国内网络），请从 https://pixabay.com/zh/music/ 手动下载 MP3 并按 README 命名放入本目录。"
