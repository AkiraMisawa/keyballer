# Keyballer

[English](README.md) | 日本語

GitHub Actions でキーボードのファームウェアをビルドし、ブラウザからそのまま書き込むアプリです。

**アプリ：** 開発中のため公開していません。手元で `npm ci && npm run build && npm run preview` を実行し、http://127.0.0.1:4173/?lang=ja を開いてください（英語・日本語。`?lang=ja` を付けると日本語で開きます）。書き込みもそこでできます。

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
| キーマップの編集画面 | 対応（キー、コンボ、レイヤー） |

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
      "keymap_dir": "keymaps/am338",
      "ball": "right"
    }
  ],
  "views": {
    "keymaps/am338": {
      "layers": ["Base", "Symbol", "Number", "Function"],
      "ball": { "default": "cursor", "3": "scroll" },
      "labels": { "SCRSHOT_AREA": { "en": "Area shot", "ja": "範囲スクショ" } }
    }
  }
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
| `builds[].ball` | （省略可）キーマップ表示でのトラックボールの位置：`none`、`right`（既定）、`left`、`dual` |
| `views` | （省略可）キーマップ表示での呼び名を、キーマップのフォルダごとに：`layers`（レイヤー名）、`ball`（レイヤーごとのボールの動作。`default` で既定）、`labels`（独自キーコードの名前。`en` と `ja`） |

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

既定ブランチのビルドが成功すると、`firmware` ブランチが `manifest.json` とファームウェアだけのコミットで置き換わります。`manifest.json` には各ファイルの SHA-256 が入り、ビルドの実行はマニフェスト自体の SHA-256 を名前にした成果物（artifact）を残します。Keyballer は、既定ブランチ向けの成功したビルドの実行が記録したマニフェストと一致するファームウェアだけを書き込み、その実行と commit を表示します。トークンで `firmware` ブランチを書き換えることはできても、実行が記録した内容は変えられません。そのため、トークンが漏れても、`main` へのコミットなしにキーボードへファームウェアを入れることはできません。記録は GitHub が 90 日間保存し、それより古いファームウェアはビルドし直してから書き込みます。同じ理由で、`keyballer.json` では、ビルドが取り込むものを固定します。`sources[].ref` は commit の SHA（40 桁）で、`qmk.image` を書くなら `@sha256:` で固定してください。`main` には、強制 push と削除を禁止するルールセットを設定するのがおすすめです。

## 手元でビルドする

Docker で、GitHub Actions と同じイメージ・同じスクリプトを使えます。

```sh
docker run --rm \
  -v "$PWD/keyballer:/keyballer:ro" \
  -v "$PWD/keyballer-config:/config:ro" \
  -v "$PWD/out:/out" \
  -e WORK_DIR=/tmp/keyballer-work \
  ghcr.io/qmk/qmk_cli@sha256:2dc05fc9f32efebd6b05c2b8676ee548358bc7e151e9dbf4dac6b6eed4513b07 \
  python3 /keyballer/scripts/build_qmk.py /config /out
```

出来上がった `out/*.hex` は、アプリの「手元の hex ファイルを書き込む」から書き込めます。

Apple Silicon の Mac では arm64 版のイメージが使われ、GitHub Actions（x86 版）より古い avr-gcc（5.4.0 と 8.3.0）が入っています。そのため、手元でビルドしたほうが数百バイト大きくなります。

## 開発

```sh
npm ci
npm run dev     # 開発サーバー（http://127.0.0.1:5173）
npm test        # Vitest（書き込み手順は模擬ブートローダーで検証）
npm run build   # 型チェックとビルド。dist/ にサインインの設定が入っていないかも確かめる
```

### 手元のパソコンでのサインイン

Keyballer を手元で動かしているとき（`npm run dev`、または `npm run build` のあと `npm run preview` で http://127.0.0.1:4173）は、トークンを貼り付ける代わりに GitHub でサインインできます。公開サイトでは、これまでどおりトークンを貼り付けます。

サインインは、タブを閉じるか 8 時間たつと終わります。アクセスできるのは、アプリをインストールしたリポジトリだけです。サインアウトするかタブを閉じると、そのサインインは GitHub 上でも取り消されます。計画と脅威モデル：[docs/plans/github-login.md](docs/plans/github-login.md)（英語）

自分用の GitHub App が必要です。<https://github.com/settings/apps/new> で登録します。

- **Homepage URL：** 何でもかまいません（このリポジトリなど）。
- **Callback URL：**
  - `http://127.0.0.1:5173/auth/callback`
  - `http://127.0.0.1:4173/auth/callback`
- **Expire user authorization tokens：** オン。
- **オフにするもの：**
  - 「Request user authorization (OAuth) during installation」
  - 「Enable Device Flow」
  - Setup URL
  - Webhook の「Active」
- **Repository permissions：** Contents は「Read and write」、Actions は「Read」（Metadata の「Read」は GitHub が自動で付けます）。Account permissions は付けません。
- **Where can this GitHub App be installed?：** Only on this account。

続けて、アプリのページで次の手順を行います。

1. client secret を作ります。
2. 設定リポジトリだけにアプリをインストールします（「Only select repositories」）。
3. このリポジトリの一番上に `.env.local` を作り、設定を書きます。このファイルは git が無視するので、コミットしないでください。

```sh
KEYBALLER_GITHUB_CLIENT_ID=<アプリの Client ID>
KEYBALLER_GITHUB_CLIENT_SECRET=<client secret>
KEYBALLER_GITHUB_APP_SLUG=<アプリの URL 上の名前。インストールへのリンクに使う（任意）>
```

これらは Vite のサーバー側だけで読み込みます。ページにも `dist/` にも入りません。

ビルド用スクリプトのテストは `python3 -m unittest discover -s scripts -p 'test_*.py'` で動きます。

`main` に push すると、テストとビルドが動きます。GitHub Pages への公開は止めてあります。デプロイは、リポジトリ変数 `PAGES_PUBLISHED` が `true` で、Pages が有効になっていて、ソースが「GitHub Actions」のときだけ動きます。

### キーマップ表示

ビルドのたびに、ファームウェアの隣に `<id>.view.json` も書き出します。キーボードの VIA 定義から取った実際の形の上のキーマップ、レイヤー、コンボ、`#define` の別名、キーマップのコードが扱うキーコードとその行番号が入っています。アプリでは「キーマップを見る」（`V`）で開きます。作れなかったときは manifest に理由が残り、ファームウェアには影響しません。計画：[docs/plans/keymap-view.md](docs/plans/keymap-view.md)（英語）

### キーマップの編集

キーマップで `E` を押すと編集を始めます。キーを選び、キー選択から新しい動作を割り当てます。QMK の名前、印字される文字、英語や日本語の言葉で探せるほか、パソコンのキーを押して割り当てることもできます（`K`）。長押しの動作も付けられます。コンボはボード上で追加・削除でき、レイヤーの追加・削除・名前の変更もできます。変わるのは `keymap.c` のデータ部分（レイヤーの配列、コンボ、`KEYBALLER_SCROLL_LAYERS`）だけで、自分で書いたコードはそのまま残ります。レイヤーの名前とスクロールするレイヤーは `keyballer.json` にも書きます。最初のコンボを足すと、コンボを有効にするため `rules.mk` に `COMBO_ENABLE = yes`、`config.h` に `#define COMBO_ONLY_FROM_LAYER 0` も書きます。どの操作もコマンドラインから使えます（`assign KC_ESC`、`assign KC_A hold=ctrl`、`combo add`、`layer rename Mouse keys`、`save Fix the comma combo`）。保存は下と同じです。計画：[docs/plans/keymap-editor.md](docs/plans/keymap-editor.md)（英語）

### トラックボールの設定と保存

キーマップでトラックボールを選ぶ（`B`）と、カーソルとスクロールの速さを設定できます。どちらも設定値と、ボール 1 cm あたりのカウント数・段数で表示します。パッドで書き込む前に自分のボールで速さを試せるほか、ボールを 1 回転させてセンサーを測れます。変更はバーにたまり、元に戻す・やり直す（⌘Z / Ctrl+Z）ができます。「確認して保存」（⌘S / Ctrl+S）で変更とファイルの差分を確かめてから、設定リポジトリの `main` に commit し、ファームウェアのビルドが始まります。保存には、そのリポジトリの Contents を「読み取りと書き込み」にした fine-grained トークン（`github_pat_`）が必要です。Keyballer は、タブを開いている間だけトークンを保持し、ブラウザのストレージには保存しません。書き込めるすべてのリポジトリにアクセスできる classic トークン（`ghp_`）は受け付けません。計画：[docs/plans/trackball-settings.md](docs/plans/trackball-settings.md)、[docs/plans/keymap-editor.md](docs/plans/keymap-editor.md)（英語）

デザインのルール（色、文字、キーキャップ、言葉づかい、アクセシビリティ、使わないもの）は [DESIGN.md](DESIGN.md) にあります（英語）。`npm test` で、そこで決めた色のコントラストを確かめます。

画面の文言はすべて `src/i18n/messages.ts` にあります。英語が基準で、日本語の訳が足りないと型チェックで、日英で差し込む値が食い違うとテストで失敗します。アプリは、`?lang=ja` か保存された選択がない限り英語で開きます。

## これから

1. ZMK のビルドと UF2 の書き込み
2. GitHub ログイン、LED の設定、テンプレート
3. AI によるキーマップの変更（同じ確認画面で確かめてから保存）
