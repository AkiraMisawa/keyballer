# Keyballer

GitHub Actions でキーボードのファームウェアをビルドし、ブラウザからそのまま書き込むアプリです。

**アプリ：** https://akiramisawa.github.io/keyballer/

```
設定リポジトリ（キーマップなど） ──push──▶ GitHub Actions がビルド
                                               │
                                               ▼
                                    firmware ブランチに hex を置く
                                               │
Keyballer（このアプリ） ◀──GitHub API で取得───┘
     │
     └──Web Serial──▶ キーボード（Pro Micro）
```

- 設定はキーボードごとの GitHub リポジトリに置きます。キーマップを変えて push するだけでビルドが始まります。
- ビルドの手順はこのリポジトリの共通ワークフローにまとめてあり、設定リポジトリからは数行で呼び出せます。
- 書き込みは Chrome / Edge の Web Serial を使います。ソフトのインストールは要りません。

## 対応状況

| | 状況 |
| --- | --- |
| QMK のビルド | 対応（QMK 本体の外にある機種定義も取り込めます。例：Yowkees/keyball） |
| ZMK のビルド | 予定 |
| Pro Micro（ATmega32U4 / Caterina）への書き込み | 対応 |
| RP2040・nRF52840（UF2）への書き込み | 予定 |
| キーマップの編集画面 | 予定 |

## 設定リポジトリ

例：[AkiraMisawa/keyballer-config](https://github.com/AkiraMisawa/keyballer-config)

```
keyballer.json              ビルドするものの一覧
keymaps/<keymap>/           QMK のキーマップ（keymap.c、config.h、rules.mk）
.github/workflows/build.yml 共通ワークフローを呼ぶだけ
```

### keyballer.json

```json
{
  "firmware": "qmk",
  "qmk": { "version": "0.22.14" },
  "sources": [
    {
      "repo": "Yowkees/keyball",
      "ref": "4664de991d14da34bd42e7031ac7406b6ccb02af",
      "path": "qmk_firmware/keyboards/keyball",
      "as": "keyball"
    }
  ],
  "builds": [
    {
      "id": "keyballplus",
      "name": "Keyball+",
      "keyboard": "keyball/keyballplus",
      "keymap": "am338",
      "keymap_dir": "keymaps/am338"
    }
  ]
}
```

| 項目 | 内容 |
| --- | --- |
| `qmk.version` | 使う QMK のタグ |
| `qmk.image` | （省略可）ビルドに使う `ghcr.io/qmk/qmk_cli` のイメージ。省略すると QMK 0.22.14 で動作確認済みのものを使います |
| `sources[]` | QMK 本体にない機種定義の取り込み元。`repo` の `ref` の時点の `path` を、QMK の `keyboards/<as>` として使います |
| `builds[].id` | 出力ファイル名に使う ID（英小文字・数字・`-`・`_`） |
| `builds[].name` | アプリに表示する名前 |
| `builds[].keyboard` / `keymap` | `qmk compile -kb <keyboard> -km <keymap>` に渡す値 |
| `builds[].keymap_dir` | 設定リポジトリ内のキーマップのフォルダ。複数のビルドで共有できます |

### .github/workflows/build.yml

```yaml
name: Build firmware

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: build-firmware
  cancel-in-progress: true

jobs:
  build:
    uses: AkiraMisawa/keyballer/.github/workflows/build-qmk.yml@main
    permissions:
      contents: write
```

ビルドが成功すると、`firmware` ブランチが `manifest.json` とファームウェアだけのコミットで置き換わります。

## 手元でビルドする

Docker で、GitHub Actions と同じイメージ・同じスクリプトを使えます。

```sh
docker run --rm \
  -v "$PWD/keyballer:/keyballer:ro" \
  -v "$PWD/keyballer-config:/config:ro" \
  -v "$PWD/out:/out" \
  ghcr.io/qmk/qmk_cli@sha256:2dc05fc9f32efebd6b05c2b8676ee548358bc7e151e9dbf4dac6b6eed4513b07 \
  python3 /keyballer/scripts/build_qmk.py /config /out
```

出来上がった `out/*.hex` は、アプリの「手元の hex ファイルを書き込む」から書き込めます。

## 開発

```sh
npm ci
npm run dev     # 開発サーバー
npm test        # Vitest（書き込み手順は模擬ブートローダーで検証）
npm run build   # 型チェックとビルド
```

`main` に push すると、テストとビルドのあと GitHub Pages に公開されます。

## これから

1. ZMK のビルドと UF2 の書き込み
2. キーマップの編集画面（保存＝commit）
3. トラックボール（物理単位での感度設定・校正）と LED の設定、GitHub ログイン、テンプレート
