# キーマップ編集画面の設計調査：AI スロップを避けるために

調査日：2026-11-21。Keyballer の次の画面（キーマップ編集。保存＝設定リポジトリへの commit）を作る前に、次の 4 点を一次情報で調べた。

1. 「AI スロップ」と呼ばれる画面の特徴と、その避け方
2. 既存のキーマップ編集ツールの画面の作り（ソースコードと、利用者の不満）
3. キーボードという題材そのものから出てくる設計の手がかり
4. 作る前と作った後に、スロップになっていないかを確かめる方法

ソースコードは調査日時点のコミットに固定したリンクで示す（`ファイル:行`）。一次情報が見つからず二次情報に頼った箇所、確認できなかった箇所はその場で書く。

**依頼の前提と違った点**：Keyball Link は「公開ソースなし」と聞いていたが、ソースは [Yowkees/keyball-link](https://github.com/Yowkees/keyball-link)（調査時 `6f6b1fb`、2026-11-19）で公開されており、Issues と Discussions もある。本書では渡された本番バンドルの文言と、このソースの両方を使った。

---

## 要約

- **スロップの正体は「選んでいないこと」**。AI ベンダー自身が、生成 UI は確率の高い中心（Inter、白地に紫のグラデーション、同じ角丸のカード）に寄ると書いている。避ける方法は禁止リストを守ることではない。題材の素材と言葉から選ぶことと、一か所だけ大胆にして残りを抑えることだ（Anthropic の frontend-design スキル、OpenAI の Codex 手引き、Kosta Canatselis や Frank Chimero の論考で一致）。
- **キーマップ編集ツールには、すでに共有された「型」がある**。物理配列の上にキーキャップを描き、レイヤーを切り替え、下にキー一覧を置く。この型は慣習なので崩す必要はない（Chimero の言う「同じ素材を使うから似る」）。差が出るのは、凡例（タップ／ホールド／透過）の描き方、レイヤーの比較、コンボの見せ方、日本語キーの探しやすさ、保存前の確認だ。利用者の不満もここに集まっている。
- **Keyballer に固有の条件**は 3 つある。保存が git commit であること（差分を見てから確定できる）。所有者のキーマップに OS 判定やカスタム処理など GUI で表せない C コードが混ざっていること。トラックボールが配列の一部であること。この 3 つを画面の骨格にすれば、他のツールと取り替えのきく見た目にはなりにくい。

### Keyballer のキーマップ編集画面への推奨

1. **配列そのものを画面の主役にする**。カードを並べない。座標は Keyball なら `via.json`（KLE 形式。列のずれ、親指キーの回転、ボール位置の選択肢を含む）から、ZMK なら physical layout（centi 単位の `w h x y r rx ry`）から取る。Keyball39 の QMK `info.json` は回転もずれもない格子なので、描画には使わない（3.1）。
2. **ボールを配列上の実物として描き、選べる対象にする**。Keyball Link はボールのあるキー位置を円で置き換え、クリックでそのレイヤーのボール設定（カーソル／スクロールなど）を開く。この考えを引き継ぎ、レイヤーごとのボールの働きを円の中に書く（3.2）。
3. **キーキャップの凡例は keymap-drawer の慣習に合わせる**。中央＝タップ、下＝ホールド、上＝シフト時の文字、透過は「▽」を薄く、そのレイヤーに入るために押さえているキーには印を付ける。`LT(1,KC_A)` のようなキーコード文字列をキャップにそのまま出さない。ZMK Studio のように片方だけ見せる、レイヤーキーを空白にする、ということもしない（3.3）。
4. **レイヤーは名前で呼び、比べられるようにする**。名前付きのタブと「全レイヤー」の並列表示を用意する。並べ替えたときは `LT()`／`MO()` の番号が追従することをプレビューで見せる（3.4）。
5. **コンボは配列の上の、関係するキーの間に描く**（keymap-drawer の combo 箱と線）。数が多いときは一覧に切り替え、キーを選んで絞り込めるようにする（3.5）。
6. **キー選択は検索を主、カテゴリを従にする**。日本語名と別名で引けるようにする（英数・かな・変換・無変換・ろ・¥・半角/全角）。凡例は JIS／US、Mac／Windows を切り替えて表示でき、「表示だけが変わり、送るキーは変わらない」と明記する。`LT()` にシフト記号を入れるなど、ファームウェアが受け付けない組み合わせは選べなくする（3.6）。
7. **「押して割り当て」を、状態が見えるモードとして用意する**。`KeyboardEvent.code`（物理位置）を使い、IME の変換中（`isComposing`）は無視する（3.7）。
8. **GUI で表せない部分を壊さず、見えるようにする**。編集するのは `keymaps[]` やコンボ表などのデータ部分に限る。`is_mac` の分岐や `process_record_user` で振る舞いが変わるキーには「コード側で調整あり」と印を付け、該当行を示す（3.8）。
9. **commit の前に二つの差分を見せる**。配列上の差分（変わったキーを旧→新で）とファイルの差分だ。コミットメッセージは変更内容から下書きする。読み込んだ時点の commit と今の先頭が違えば止める。元に戻す／やり直しと未保存表示も持たせる（3.9）。
10. **見た目は今の Keyballer の語彙を延ばす**。灰色のキーキャップに、赤を一色だけ使う。赤は「選択中のキー」と「ボール」に限る。カードの格子、見出しの上の小さなラベル、グラデーション、絵文字アイコン、装飾としての等幅フォント、全キーのホバー拡大は入れない。作る前に状態一覧と配色案を書いて似た依頼と比べ、作った後は APG と WCAG 2.2 で点検する。最後に、所有者自身の `am338` キーマップを GUI で作り直し、ビルド結果が一致するかで確かめる（1.4、4 章）。

---

## 1. AI スロップの特徴と避け方

### 1.1 何が起きているのか

- Anthropic は、指示のない LLM が作るランディングページは「ほぼ必ず Inter、白地に紫のグラデーション、控えめなアニメーション」になると書き、原因を *distributional convergence*（分布の中心への収束）と呼んでいる。誰も困らない安全な選択が学習データの多数派なので、指示がなければその中心から取り出す、という説明だ（[Claude ブログ「Improving frontend design through Skills」2025-11-12](https://claude.com/blog/improving-frontend-design-through-skills)）。
- UI デザイナーの Kosta Canatselis は、スロップを「下手なデザイン」とは区別し、「作者のいないデザイン」「一万の画面の統計的な平均」と定義している（[Spot the Slop, 2026-07-23](https://world.hey.com/kostac/spot-the-slop-a-ui-designer-s-guide-to-fixing-ai-defaults-4c448c9c)）。
- デザイナーの Frank Chimero は「平均的なメールやコードは構わないが、平均的な作品は困る」と書き、AI の平均への引力に逆らうには、横で一緒に作りながら形を整え、足りないものに耳を澄ますしかないと述べる（[Beyond the Machine, 2025](https://frankchimero.com/blog/2025/beyond-the-machine/)）。
- 一方で、似ていること自体は悪ではない。Chimero は 2015 年に「同じ素材を使うから多くのサイトは同じ解き方を共有する。それは素材の要請に応える型の証拠であって、視覚的な単一文化の証拠ではない」と書いている（[The Web's Grain](https://frankchimero.com/blog/2015/the-webs-grain/)）。Web デザインの均質化を測った CHI '21 の論文（Goree ほか、DOI 10.1145/3411764.3445156）もあるが、本文は今回取得できず、要約しか確認していない（弱い根拠）。

キーマップ編集ツールに当てはめると、「配列の絵の上でキーを選び、下の一覧から割り当てる」という型は素材（キーボード）の要請なので守ってよい。スロップになるのは、その型の外側にある汎用 SaaS の飾りや言葉の部分だ。

### 1.2 一次情報が名指ししているパターン

| 領域 | 名指しされているパターン | 出典 |
| --- | --- | --- |
| 配色 | 白地に紫のグラデーション | [frontend-design 2025 版 L36](https://github.com/anthropics/skills/blob/00756142ab04c82a447693cf373c4e0c554d1005/skills/frontend-design/SKILL.md#L36)、[web-artifacts-builder L20](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/web-artifacts-builder/SKILL.md#L20)、[Codex Prompting Guide「Frontend tasks」](https://github.com/openai/openai-cookbook/blob/dfd760b4de0bd175b51ad05b9b5260c36dfea09c/examples/gpt-5/codex_prompting_guide.ipynb) |
| 配色 | 暖かいクリーム地（#F4F1EA 付近）＋コントラストの強いセリフ見出し＋テラコッタのアクセント（#D97757 付近） | [frontend-design 2026 版 L39](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md#L39) |
| 配色 | ほぼ黒の背景に、明るい酸性グリーンか朱色のアクセントを一色だけ | [同 L40](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md#L40) |
| 配色 | 黒の代わりに色味のある近黒（#0B0B0B、#111） | [同 L43](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md#L43) |
| 配色 | 装飾としてのグラデーション。色の名前が `gradient-start` / `gradient-end` なら要注意。色は意味（主操作、警告、成功）で使う | [Kosta](https://world.hey.com/kostac/spot-the-slop-a-ui-designer-s-guide-to-fixing-ai-defaults-4c448c9c) 2 項 |
| 文字 | Inter、Roboto、Arial、システムフォント。世代を越えて Space Grotesk に収束する | [frontend-design 2025 版 L36-38](https://github.com/anthropics/skills/blob/00756142ab04c82a447693cf373c4e0c554d1005/skills/frontend-design/SKILL.md#L36-L38)、[Cookbook](https://github.com/anthropics/claude-cookbooks/blob/8ad5de647d4f0f50c95d74aabc8aa20a3f70cdd3/coding/prompting_for_frontend_aesthetics.ipynb)（Open Sans、Lato も） |
| 文字 | 見出しの一語だけ斜体・太字・別色にする／ラベルを全部大文字にする／内容の上に不要な小見出しを置く | [frontend-design 2026 版 L25-28](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md#L25-L28) |
| 文字 | 字間を広げた大文字の「アイブロウ」を全見出しの上に／`A · B · C` の中黒区切り／`WORD — 断片` の空白付きダッシュ／小さなデータラベルに等幅フォント／リンクやボタンの末尾に「→」 | [同 L43](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md#L43) |
| 文字 | 「技術っぽさ」の衣装としての等幅フォント（コード・データ・計測以外で使う） | [impeccable craft-floor L38](https://github.com/pbakaus/impeccable/blob/b49177d32788f2dc585c42831d845dacf1ebed2c/skill/reference/craft-floor.md#L38) |
| 配置 | 中央寄せの多用、全要素に同じ角丸 | [web-artifacts-builder L20](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/web-artifacts-builder/SKILL.md#L20) |
| 配置 | 「SaaS カードの部品箱」：同じ角丸のカードに切り分け、同じ薄い影（rgba(0,0,0,.1)）を全部に付ける | [frontend-design 2026 版 L42](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md#L42) |
| 配置 | 大きな数字＋小さなラベル＋補助の数値＋アクセント（ヒーロー指標） | [同 L17](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md#L17)、[impeccable L26](https://github.com/pbakaus/impeccable/blob/b49177d32788f2dc585c42831d845dacf1ebed2c/skill/reference/craft-floor.md#L26) |
| 配置 | 順序でもないのに 01 / 02 / 03 の番号 | [frontend-design 2026 版 L30](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md#L30)、[impeccable L28](https://github.com/pbakaus/impeccable/blob/b49177d32788f2dc585c42831d845dacf1ebed2c/skill/reference/craft-floor.md#L28) |
| 配置 | 必要のない場面でのモーダル | [impeccable L29](https://github.com/pbakaus/impeccable/blob/b49177d32788f2dc585c42831d845dacf1ebed2c/skill/reference/craft-floor.md#L29) |
| 配置 | すべてを常に表示する（入力表・入力パネル・書き出しパネルが同時に並ぶ） | [Kosta](https://world.hey.com/kostac/spot-the-slop-a-ui-designer-s-guide-to-fixing-ai-defaults-4c448c9c) 7 項 |
| 表面 | グラデーション文字、飾りとしてのガラス・ぼかし、角丸の箱の片側だけの色帯、ずらしただけの硬い影、ずれのない色付きの光彩 | [impeccable L10, L33-36](https://github.com/pbakaus/impeccable/blob/b49177d32788f2dc585c42831d845dacf1ebed2c/skill/reference/craft-floor.md#L33-L36)、Kosta 冒頭（「左端の色線＋カーブ」） |
| 図像 | Unicode 記号や絵文字でアイコンの代わりをする | [impeccable L40](https://github.com/pbakaus/impeccable/blob/b49177d32788f2dc585c42831d845dacf1ebed2c/skill/reference/craft-floor.md#L40) |
| 動き | 各セクションのフェード＋スライドアップ、全カードのホバー遷移。意図した動きは一か所で十分 | [frontend-design 2026 版 L32](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md#L32)、[impeccable L13](https://github.com/pbakaus/impeccable/blob/b49177d32788f2dc585c42831d845dacf1ebed2c/skill/reference/craft-floor.md#L13) |
| 文言 | 誰にでも当てはまる見出し（「Build the future of work」） | [Kosta](https://world.hey.com/kostac/spot-the-slop-a-ui-designer-s-guide-to-fixing-ai-defaults-4c448c9c) 3 項 |
| 文言 | 「Submit」ではなく何が起きるかを書く（「Save changes」）。同じ操作は最後まで同じ名前（「Publish」→「Published」）。エラーは謝らず、何が起きたかと直し方を書く。空の画面は行動への誘いにする | [frontend-design 2026 版 L63-71](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md#L63-L71) |
| 状態 | うまくいく場合しか作らない。空・読み込み中・エラー・入力ミスの画面がない | [Kosta](https://world.hey.com/kostac/spot-the-slop-a-ui-designer-s-guide-to-fixing-ai-defaults-4c448c9c) 5 項、[impeccable L14](https://github.com/pbakaus/impeccable/blob/b49177d32788f2dc585c42831d845dacf1ebed2c/skill/reference/craft-floor.md#L14) |
| 細部 | 選択色、キャレット、スクロールバー、フォーカスリング、下線の位置、表の数字がブラウザ既定のまま | [impeccable L15](https://github.com/pbakaus/impeccable/blob/b49177d32788f2dc585c42831d845dacf1ebed2c/skill/reference/craft-floor.md#L15) |

Anthropic のスキルは、2025 年版（[`00756142`](https://github.com/anthropics/skills/blob/00756142ab04c82a447693cf373c4e0c554d1005/skills/frontend-design/SKILL.md)）から 2026-09 版（[`41bbe19d`](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md)、コミット名「avoid generic design defaults」）で大きく変わった。2025 年版は「大胆な方向を選べ」「グラデーションメッシュやノイズで雰囲気を」と飾りを足す方向だった（[L13-19, L34](https://github.com/anthropics/skills/blob/00756142ab04c82a447693cf373c4e0c554d1005/skills/frontend-design/SKILL.md#L13-L34)）。2026 年版はむしろ、飾りを足した結果として生まれた新しい既定（クリーム＋テラコッタ、近黒＋一色、新聞風、カード部品箱）を名指しで外している。同じ内容が [anthropics/claude-plugins-official の frontend-design プラグイン](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/frontend-design) にもある（調査日時点で同一）。

### 1.3 ベンダー間でも食い違う点と、共通する点

- **食い違う点**：OpenAI の GPT-5 プロンプト手引きは、新しいアプリに Tailwind CSS、shadcn/ui、Radix Themes、アイコンは Material Symbols／Heroicons／Lucide、フォントは Inter・Geist・Mona Sans・IBM Plex Sans・Manrope を勧めている（[gpt-5_prompting_guide「Frontend app development」](https://github.com/openai/openai-cookbook/blob/dfd760b4de0bd175b51ad05b9b5260c36dfea09c/examples/gpt-5/gpt-5_prompting_guide.ipynb)、[gpt-5_frontend](https://github.com/openai/openai-cookbook/blob/dfd760b4de0bd175b51ad05b9b5260c36dfea09c/examples/gpt-5/gpt-5_frontend.ipynb)）。ところが同じ OpenAI の Codex 手引きは「AI slop に落ちるな。Inter・Roboto・Arial・system の既定スタックを避けよ。紫・ダークモードへの偏りをなくせ」と書く（[codex_prompting_guide「Frontend tasks」](https://github.com/openai/openai-cookbook/blob/dfd760b4de0bd175b51ad05b9b5260c36dfea09c/examples/gpt-5/codex_prompting_guide.ipynb)）。特定のフォント名を禁じることが本質ではない、という読み方が妥当だ。
- **共通する点**：既存のデザインがあるならそれに従う。Codex 手引きは「既存のサイトやデザインシステムの中で作業するときは、確立したパターン・構造・視覚言語を保つ」を例外として明記している（同上）。GPT-5.2 の手引きは「既存のデザインシステムを深く理解する」「頼まれていない色・影・トークン・アニメーション・UI 要素を発明しない」と書く（[gpt-5-2_prompting_guide 3.2](https://github.com/openai/openai-cookbook/blob/dfd760b4de0bd175b51ad05b9b5260c36dfea09c/examples/gpt-5/gpt-5-2_prompting_guide.ipynb)）。Anthropic も「依頼が方向を決めている軸ではそれに正確に従う」（[frontend-design 2026 版 L45](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md#L45)）。Keyballer には既存の配色と文体があるので、新画面はそれを延ばすのが筋になる。

### 1.4 避け方（手順として）

frontend-design 2026 版の手順をキーマップ編集に当てはめると次のようになる。

1. **題材から始める**。業界、素材、その世界の言葉が独自の選択の出どころになる（[L11-13](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md#L11-L13)）。キーボードの世界なら、キーキャップの印字、1u という単位、列のずれ、親指クラスタ、凡例の書き方（keymap-drawer）、自作キーボードの配列図が素材になる。
2. **二段階で作る**。最初に 4〜6 色の名前付き配色、書体と役割、ASCII のワイヤーフレーム、この画面だけの原則を書く。次に「似た依頼でも同じ結果になるか」を自問し、なるなら直して理由を書く。その後でコードを書く（[L47-53](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md#L47-L53)）。
3. **大胆さは一か所だけ**。記憶に残る要素を一つ決め、周りは静かにする。「出かける前に鏡を見て、アクセサリーを一つ外す」（[L59](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md#L59)）。キーマップ編集なら、その一か所は配列の絵（凡例とボール）であるべきだ。
4. **品質の下限を黙って守る**。スマホ幅、見えるフォーカス、reduced motion、色の調和（同 L59）。
5. **止まって見る**。Kosta は「作る、止まる、目がどこに行きどこで詰まるかを見る、疲れているときに小さい画面でゆっくり触る、他人に使ってもらい口を出さずに見る」を勧める（[Kosta「The real fix isn't a checklist」](https://world.hey.com/kostac/spot-the-slop-a-ui-designer-s-guide-to-fixing-ai-defaults-4c448c9c)）。

### 1.5 Keyballer の現状を照らす

現状の Keyballer（[`src/styles.css`](https://github.com/AkiraMisawa/keyballer/blob/a963c8b5256cc8060ab7c7979215953a6dbc8059/src/styles.css)）は、すでに多くの既定を避けている。

- 色は灰色の中間色に、赤のアクセント一色（[L1-24](https://github.com/AkiraMisawa/keyballer/blob/a963c8b5256cc8060ab7c7979215953a6dbc8059/src/styles.css#L1-L24)。注記に「trackball-red accent」とある）。状態色（ok / busy / err）はアクセントと分けてある。
- 影もグラデーションもない。動きは進捗バーの幅の遷移一つだけで、`prefers-reduced-motion` で止める（[L469](https://github.com/AkiraMisawa/keyballer/blob/a963c8b5256cc8060ab7c7979215953a6dbc8059/src/styles.css#L469)、[L495](https://github.com/AkiraMisawa/keyballer/blob/a963c8b5256cc8060ab7c7979215953a6dbc8059/src/styles.css#L495)）。
- 等幅フォントは `keyboard:keymap` のような実際の識別子にだけ使っている（[`FirmwareCard.tsx`](https://github.com/AkiraMisawa/keyballer/blob/a963c8b5256cc8060ab7c7979215953a6dbc8059/src/components/FirmwareCard.tsx)）。
- 文言は操作をそのまま書く平叙文（「書き込む」「反対側を書き込む」「リセットボタンを押してください」）。

気を付ける点は二つある。

- **暗色時は名指しされた傾向 2 に近い**。`--bg: #15191d` に `--accent: #ff7a5c`（[L27-34](https://github.com/AkiraMisawa/keyballer/blob/a963c8b5256cc8060ab7c7979215953a6dbc8059/src/styles.css#L27-L34)）は、「近黒＋朱色一色」と見分けにくい。ライトが主でダークはその反転という成り立ちなので問題は小さい。ただ編集画面では、赤の意味（選択中のキー、ボール）を固定して面積を絞るとよい。
- **書体は既定のシステム和文フォント**（[L20](https://github.com/AkiraMisawa/keyballer/blob/a963c8b5256cc8060ab7c7979215953a6dbc8059/src/styles.css#L20)）。2025 年版のスキルは「system fonts」も名指ししたが、2026 年版はフォント名の禁止をやめ、「意図して選べ」とだけ書く（[frontend-design 2026 版 L19-21](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md#L19-L21)）。和文の本文はヒラギノ等のままでよい。意図して選ぶべきなのは、キーキャップの凡例の書体・大きさ・位置だ。これは画面の「一か所の大胆さ」に当たる（3.3）。

比較のために、同じ題材の Keyball Link の見た目を記録しておく。既定は暗色地 `#0e1418` にミント `#48d6a8`（[`src/index.css` L1-16](https://github.com/Yowkees/keyball-link/blob/6f6b1fbe70f91d682fefe0946309f4500d0c7637/src/index.css#L1-L16)）。見出しは Space Grotesk、ほかに JetBrains Mono と Noto Sans JP を読み込む（[`index.html` L10](https://github.com/Yowkees/keyball-link/blob/6f6b1fbe70f91d682fefe0946309f4500d0c7637/index.html#L10)、[`index.css` L35-37](https://github.com/Yowkees/keyball-link/blob/6f6b1fbe70f91d682fefe0946309f4500d0c7637/src/index.css#L35-L37)）。ブランド下に大文字の `WEB CONFIGURATOR` と点滅カーソルを置き、ボタンには「🔀」「↩」「●」「📋」「✅」などの記号・絵文字を使う（本番バンドルの文言）。1.2 の表の「近黒＋明るい一色」「Space Grotesk」「装飾の等幅」「大文字ラベル」「絵文字アイコン」に重なる。リポジトリには AI コーディングエージェント向けの [`CLAUDE.md`](https://github.com/Yowkees/keyball-link/blob/6f6b1fbe70f91d682fefe0946309f4500d0c7637/CLAUDE.md) がある。ただし、見た目が一致するというだけで、作り方の証明にはならない。機能面では Keyball Link から学ぶ点が多い（2.8）。

---

## 2. 既存ツールの比較

### 2.0 一覧

| ツール | 形態と保存先 | 配列の描き方 | レイヤー | キー選択 | タップ／ホールドの見せ方 | コンボ・マクロなど |
| --- | --- | --- | --- | --- | --- | --- |
| QMK Configurator | Web。JSON 書き出し、サーバーでコンパイル | info.json の座標、div 配置 | 番号 | キーボード形の一覧（ANSI、ISO/JIS…）＋検索、ドラッグ、物理キーを押して割り当て | 外側にラベル、内側の枠にタップキー | コンボなし（要望 #1154） |
| VIA | Web/Electron。キーボードに即時書き込み | VIA 定義（KLE）、2D と 3D | 番号のボタンだけ | カテゴリ（Basic, Media, Macro, Layers, Special…）＋「Any」で自由入力 | 基本キー以外はキーコード文字列をそのまま | マクロのみ。コンボ・タップダンスなし（#248, #160） |
| Vial | デスクトップ（Qt）＋Web。即時書き込み | KLE、回転対応 | 番号ボタン | 下部タブ（Basic, ISO/JIS, Layers, Quantum…）、「Any」 | 上に外側（例 `LT 1`）、下の窪みに内側（例 `A`） | 別タブ：Macros, Tap Dance, Combos, Key Overrides, Alt Repeat Key |
| ZMK Studio | Web/デスクトップ。即時書き込み、Save/Discard | physical layout（centi 単位、回転） | 名前付き一覧、ドラッグで並べ替え | ビヘイビア選択＋HID の検索付きコンボボックス | 上に短縮したビヘイビア名、下に第 1 引数だけ | 未対応（ドキュメントで「Planned」） |
| keymap-editor (nickcoutsos) | Web。GitHub に直接 commit | ZMK 配列、回転対応 | 一覧 | あいまい検索（fuzzysort）のダイアログ | ビヘイビア名＋引数を入れ子で表示 | コンボ・マクロ・ビヘイビア編集あり |
| ZSA Oryx | Web。クラウドでコンパイル、layout revisions で履歴 | ZSA 製品の固定の配列 | 一覧（詳細は未確認） | 検索、言語名で各国語のカテゴリ | Tap / Hold / Double tap / Tap then hold。Advanced view で「D」「T」の印。キーに独自の表示名 | コンボはサイドバーの一覧、乗ると配列上で強調 |
| Karabiner-Elements | macOS アプリ。JSON の設定ファイル | 配列は描かない | なし（プロファイル） | カテゴリの入れ子メニュー（検索なし）、EventViewer で押して名前を調べる | Complex Modifications のルールで表す | ルールとして JSON で記述 |
| Keyball Link | Web（WebHID）。キーボードに保存＋JSON 書き出し | via.json の KLE 座標、回転、ボールを円で | L0〜、色の点、ドラッグで並べ替え、全レイヤー表示 | 検索＋カテゴリ（すべて、文字/数字、記号、操作、F/テンキー、日本語、レイヤー、マウス…）、ドラッグとクリック | キャップに 2 行（上がタップ、下が `L1` や修飾名）。説明欄に「タップ：… ／ 長押し：…」 | 「マクロ拡張」タブにマクロ・タップダンス・コンボ |

### 2.1 QMK Configurator（[qmk/qmk_configurator](https://github.com/qmk/qmk_configurator) `2dcdb25`）

- **画面構成**：上部にキーボード選択とコンパイル（`controllerTop`）。左にレイヤー一覧（`layerControl`）、右に配列（`visualKeymap`）、その下にキーコード一覧（[`src/components/Main.vue` L1-60](https://github.com/qmk/qmk_configurator/blob/2dcdb25feedd148be6c7f37593bd1c051262cdee/src/components/Main.vue#L1-L60)）。
- **キー一覧は「キーボードの絵」**。タブは ANSI、ISO/JIS、Quantum、Keyboard Settings、App, Media and Mouse、Lighting、Steno（[`src/i18n/en.csv` L45-51](https://github.com/qmk/qmk_configurator/blob/2dcdb25feedd148be6c7f37593bd1c051262cdee/src/i18n/en.csv#L45-L51)）。ANSI や ISO/JIS のタブは、フルサイズキーボードの配置どおりにキーを並べる（[`src/store/modules/keycodes/iso-jis.js`](https://github.com/qmk/qmk_configurator/blob/2dcdb25feedd148be6c7f37593bd1c051262cdee/src/store/modules/keycodes/iso-jis.js)）。検索するとタブごとの件数が出る（[`Keycodes.vue` L22-50](https://github.com/qmk/qmk_configurator/blob/2dcdb25feedd148be6c7f37593bd1c051262cdee/src/components/Keycodes.vue#L22-L50)）。
- **物理キーを押して割り当てられる**。キーを選んだ状態でパソコンのキーを押すと、その keycode が入る（[`keypress-utils.js` L54-108](https://github.com/qmk/qmk_configurator/blob/2dcdb25feedd148be6c7f37593bd1c051262cdee/src/store/modules/app/keypress-utils.js#L54-L108)）。テンキー側や右側の修飾キーは `ev.location` で区別する。検索欄にフォーカスがある間は聞き取りを止める（`@focus="stopListening"`、`Keycodes.vue`）。
- **ホスト側の配列に合わせて凡例を変えられる**。「Change the key legends to match your host keyboard layout」（[`en.csv` L127](https://github.com/qmk/qmk_configurator/blob/2dcdb25feedd148be6c7f37593bd1c051262cdee/src/i18n/en.csv#L127)）。日本語 JP106 の定義もある（[`keymap_extras/keymap_japanese.js`](https://github.com/qmk/qmk_configurator/blob/2dcdb25feedd148be6c7f37593bd1c051262cdee/src/i18n/keymap_extras/keymap_japanese.js)）。
- **Mod-Tap / Layer-Tap は「入れ物のキー」**。外側に名前（例 `LT 1`）、内側の `key-contents` にタップキーをドラッグして入れる（[`ContainerKey.vue` L1-27](https://github.com/qmk/qmk_configurator/blob/2dcdb25feedd148be6c7f37593bd1c051262cdee/src/components/ContainerKey.vue#L1-L27)、[`quantum.js` L12-13](https://github.com/qmk/qmk_configurator/blob/2dcdb25feedd148be6c7f37593bd1c051262cdee/src/store/modules/keycodes/quantum.js#L12-L13)）。
- **不満**：
  - コンボ未対応。要望者は「キーの間に小さなキーを足す」案を図で出している（[#1154, 2022-07-21](https://github.com/qmk/qmk_configurator/issues/1154)）。
  - `LT(1,%)` が `%` ではなく `5` を送る（[#1007, 2021-10-21](https://github.com/qmk/qmk_configurator/issues/1007)）。原因は QMK 側の仕様で、`LT()` と `MT()` の `kc` は基本キーコードに限られ、`KC_TILD` のようなシフト付きは使えない（[QMK docs `feature_layers.md` L27](https://github.com/qmk/qmk_firmware/blob/80973aa0b5413e9a5bbbf9293507f39e870f9aa3/docs/feature_layers.md#L27)、[`mod_tap.md` L65](https://github.com/qmk/qmk_firmware/blob/80973aa0b5413e9a5bbbf9293507f39e870f9aa3/docs/mod_tap.md#L65)）。UI が受け付けない組み合わせを止めていないことが問題だ。
  - 検索が、選んだ OS 配列の凡例を無視する（[#1372, 2024-11-08](https://github.com/qmk/qmk_configurator/issues/1372)）。
  - macOS で GUI と Alt が入れ替わる報告（[#943, 2021-07-01](https://github.com/qmk/qmk_configurator/issues/943)）。

### 2.2 VIA（[the-via/app](https://github.com/the-via/app) `75a7275`）

- **描画**：2D と 3D を切り替えられる（[`src/components/panes/settings.tsx` L120-125](https://github.com/the-via/app/blob/75a7275fd4e13b20f6d646583c5b6cbac8a9e92d/src/components/panes/settings.tsx#L120-L125)、3D は `src/components/three-fiber/`）。
- **レイヤー**：番号のボタンを並べるだけ（[`layer-control.tsx` L45-55](https://github.com/the-via/app/blob/75a7275fd4e13b20f6d646583c5b6cbac8a9e92d/src/components/panes/configure-panes/layer-control.tsx#L45-L55)）。
- **キー一覧**：カテゴリは Basic、Lighting、Media、Macro、Special、Layers、Custom、Other（[`src/utils/key.ts` L422-1087](https://github.com/the-via/app/blob/75a7275fd4e13b20f6d646583c5b6cbac8a9e92d/src/utils/key.ts#L422-L1087)）。JIS の「無変換」「変換」「かな」「Ro」は Special にある（[L855-861](https://github.com/the-via/app/blob/75a7275fd4e13b20f6d646583c5b6cbac8a9e92d/src/utils/key.ts#L855-L861)）。最後の「Any」で QMK キーコードを自由入力する（[`keycode.tsx` L315-325](https://github.com/the-via/app/blob/75a7275fd4e13b20f6d646583c5b6cbac8a9e92d/src/components/panes/configure-panes/keycode.tsx#L315-L325)、`custom-keycode-modal.tsx`）。ホストの配列を示すバッジもある（`host-keyboard-layout-badge.tsx`）。
- **「Fast Key Mapping」**：割り当てると次のキーへ自動で進む設定（[`settings.tsx` L166-171](https://github.com/the-via/app/blob/75a7275fd4e13b20f6d646583c5b6cbac8a9e92d/src/components/panes/settings.tsx#L166-L171)）。
- **凡例**：基本キー以外は短縮名がなければキーコード文字列をそのまま返す（[`key.ts` L369-389](https://github.com/the-via/app/blob/75a7275fd4e13b20f6d646583c5b6cbac8a9e92d/src/utils/key.ts#L369-L389)、`getLabel` は [`keyboard-rendering.ts` L451-](https://github.com/the-via/app/blob/75a7275fd4e13b20f6d646583c5b6cbac8a9e92d/src/utils/keyboard-rendering.ts#L451)）。
- **不満**：
  - レイヤーとマクロに名前を付けたい。「0, 1, 2, 3 や M0, M1 では何のことか分からない」（[#106, 2023-01-22](https://github.com/the-via/app/issues/106)）。
  - 使わないレイヤーを隠したい（[#238](https://github.com/the-via/app/issues/238)）。画面を移るとレイヤー番号が戻る（[#243](https://github.com/the-via/app/issues/243)）。
  - コンボ（[#248](https://github.com/the-via/app/issues/248)）とタップダンス（[#160](https://github.com/the-via/app/issues/160)）が設定できない。

### 2.3 Vial（[vial-kb/vial-gui](https://github.com/vial-kb/vial-gui) `aef8222`）

- **画面構成**：機能ごとにトップレベルのタブがある。Keymap、Layout、Macros、Lighting、Tap Dance、Combos、Key Overrides、Alt Repeat Key、QMK Settings、Matrix tester、Firmware updater（[`main_window.py` L89-93](https://github.com/vial-kb/vial-gui/blob/aef8222a2d0429a183b2ed692d5f9efcfd383f08/src/main/python/main_window.py#L89-L93)）。
- **キー一覧のタブ**：Basic、ISO/JIS、Layers、Quantum、Backlight、App, Media and Mouse、MIDI、Tap Dance、User、Macro（[`tabbed_keycodes.py` L163-185](https://github.com/vial-kb/vial-gui/blob/aef8222a2d0429a183b2ed692d5f9efcfd383f08/src/main/python/tabbed_keycodes.py#L163-L185)）。
- **Mod-Tap の描き方**：キーを上下に分け、上に外側（例 `RSft_T`）、下の窪み（mask）に内側のキー（例 `KC_A`）を描く（[`widgets/keyboard_widget.py` L85-100](https://github.com/vial-kb/vial-gui/blob/aef8222a2d0429a183b2ed692d5f9efcfd383f08/src/main/python/widgets/keyboard_widget.py#L85-L100)）。
- **コンボとタップダンス**：配列とは別のタブ。コンボは番号付きのタブごとに「Key 1〜4」と「Output key」（[`editor/combos.py` L35-44, L96](https://github.com/vial-kb/vial-gui/blob/aef8222a2d0429a183b2ed692d5f9efcfd383f08/src/main/python/editor/combos.py#L35-L44)）。タップダンスは「On tap / On hold / On double tap / On tap + hold / Tapping term (ms)」で、「Use `TD(n)` to set up this action in the keymap.」と案内する（[`editor/tap_dance.py` L37-61](https://github.com/vial-kb/vial-gui/blob/aef8222a2d0429a183b2ed692d5f9efcfd383f08/src/main/python/editor/tap_dance.py#L37-L61)）。
- **キーボード操作**：レイヤーボタンに `Qt.NoFocus` を設定しており、キーボードではフォーカスできない（[`editor/keymap_editor.py` L91, L99](https://github.com/vial-kb/vial-gui/blob/aef8222a2d0429a183b2ed692d5f9efcfd383f08/src/main/python/editor/keymap_editor.py#L91-L99)）。
- **不満**：
  - タップダンスとコンボを表形式で見たい。「64 個のコンボを一つずつスクロールしたくない」（[#354, 2025-09-10](https://github.com/vial-kb/vial-gui/issues/354)）。
  - 出力キーのないコンボが有効扱いになり、マウスの左クリックが効かなくなった（[#232, 2024-03-17](https://github.com/vial-kb/vial-gui/issues/232)）。
  - 元に戻す／やり直しがない（[#373, 2025-12-05](https://github.com/vial-kb/vial-gui/issues/373)）。
  - ズームが上半分にしか効かない、「明るさ − の前に ＋」など並び順が慣習と逆、拡大縮小のショートカットがない（[#389, 2026-05-11](https://github.com/vial-kb/vial-gui/issues/389)）。

### 2.4 ZMK Studio（[zmkfirmware/zmk-studio](https://github.com/zmkfirmware/zmk-studio) `1bb6bb8`）

- **部品**：react-aria-components、Tailwind、lucide-react を使う（[`package.json`](https://github.com/zmkfirmware/zmk-studio/blob/1bb6bb84a370c8917d8e4db15207087b26b3a844/package.json)）。
- **配列**：physical layout の `x y r rx ry` を CSS の `rotate()` と `transform-origin` にする（[`src/keyboard/PhysicalLayout.tsx` L49-65](https://github.com/zmkfirmware/zmk-studio/blob/1bb6bb84a370c8917d8e4db15207087b26b3a844/src/keyboard/PhysicalLayout.tsx#L49-L65)）。
- **キーキャップ**：上にビヘイビア名を 9 文字まで短縮して置き（例 `Momentary Layer` → `MLayer`、`Transparent` → `Transprnt`）、中央に第 1 引数の HID 用途だけを出す（[`Key.tsx` L17-35, L59](https://github.com/zmkfirmware/zmk-studio/blob/1bb6bb84a370c8917d8e4db15207087b26b3a844/src/keyboard/Key.tsx#L17-L59)、[`behavior-short-names.json`](https://github.com/zmkfirmware/zmk-studio/blob/1bb6bb84a370c8917d8e4db15207087b26b3a844/src/keyboard/behavior-short-names.json)、[`Keymap.tsx` L52-66](https://github.com/zmkfirmware/zmk-studio/blob/1bb6bb84a370c8917d8e4db15207087b26b3a844/src/keyboard/Keymap.tsx#L52-L66)）。全キーに `hover:scale-125` と影の遷移が付く（[`Key.tsx` L51](https://github.com/zmkfirmware/zmk-studio/blob/1bb6bb84a370c8917d8e4db15207087b26b3a844/src/keyboard/Key.tsx#L51)）。
- **レイヤー**：react-aria の `ListBox`（`aria-label="Keymap Layer"`）で、ドラッグで並べ替えられる（[`LayerPicker.tsx` L141-152, L201-202](https://github.com/zmkfirmware/zmk-studio/blob/1bb6bb84a370c8917d8e4db15207087b26b3a844/src/keyboard/LayerPicker.tsx#L141-L202)）。名前変更に対応する。
- **キー選択**：HID 用途は react-aria の `ComboBox`（[`behaviors/HidUsagePicker.tsx` L153](https://github.com/zmkfirmware/zmk-studio/blob/1bb6bb84a370c8917d8e4db15207087b26b3a844/src/behaviors/HidUsagePicker.tsx#L153)）。
- **保存**：ヘッダーに Undo / Redo / Save / Discard（[`AppHeader.tsx` L15-38, L133-149](https://github.com/zmkfirmware/zmk-studio/blob/1bb6bb84a370c8917d8e4db15207087b26b3a844/src/AppHeader.tsx#L15-L149)）。
- **公式ドキュメントの位置づけ**：コンボ、マクロやタップダンスの詳細設定、条件付きレイヤー、ホストのロケール選択、キーマップの読み書きは「Planned」（[zmk `docs/docs/features/studio.md` L13-41](https://github.com/zmkfirmware/zmk/blob/4de313367288aad5aeaa1243890e40dc813f7008/docs/docs/features/studio.md#L13-L41)）。また「Studio で管理し始めたら、以後 `.keymap` ファイルの変更は Restore Stock Settings をしない限り反映されない」（同 [L43-51](https://github.com/zmkfirmware/zmk/blob/4de313367288aad5aeaa1243890e40dc813f7008/docs/docs/features/studio.md#L43-L51)）。キーボード内の状態とファイルが別れてしまう。
- **不満**：
  - Mod-Tap はホールド側（例「Shft」）しか見えない（[#147, 2025-09-04](https://github.com/zmkfirmware/zmk-studio/issues/147)）。
  - `&mo` のキーが空白に見え、押してみないと分からない（[#148, 2025-09-04](https://github.com/zmkfirmware/zmk-studio/issues/148)）。
  - キー押下の一覧が全部「Keyboard ○」で始まるので、「Y」で検索すると「Keyboard」にも一致して役に立たない（[#151, 2025-09-04](https://github.com/zmkfirmware/zmk-studio/issues/151)）。
  - ビヘイビアの情報を凡例に生かしていない（[#17](https://github.com/zmkfirmware/zmk-studio/issues/17)）。
  - コンボ等がないので別のエディタを使いたいが、`.keymap` に書き出せない（[#124, 2025-01-11](https://github.com/zmkfirmware/zmk-studio/issues/124)、[#93](https://github.com/zmkfirmware/zmk-studio/issues/93)）。

### 2.5 nickcoutsos/keymap-editor（[nickcoutsos/keymap-editor](https://github.com/nickcoutsos/keymap-editor) `e794679`、2023-10）

- 公開されているソースは古い。README に「最近の変更はここでは公開していない」とある（[README](https://github.com/nickcoutsos/keymap-editor/blob/e7946792cf674db20ab72ab67fea759fff4c3ccc/README.md)）。以下は公開版の構造。
- **GitHub への保存**：「Commit Changes」ボタン（[`app/src/App.js` L97-106](https://github.com/nickcoutsos/keymap-editor/blob/e7946792cf674db20ab72ab67fea759fff4c3ccc/app/src/App.js#L97-L106)）。サーバー側で、ブランチ先頭の commit を親にし、木を作り、メッセージ固定の `'Updated keymap'` で commit して ref を進める（[`api/services/github/files.js` L89-133](https://github.com/nickcoutsos/keymap-editor/blob/e7946792cf674db20ab72ab67fea759fff4c3ccc/api/services/github/files.js#L89-L133)）。差分を見せる画面はない。読み込んだ後に別の変更が入っていても、確認せず上書きする作りに見える（コードからの推測）。
- **キーキャップ**：ビヘイビア名（例 `&mt`）と引数を入れ子で表示し、引数ごとに押して変えられる（[`Keyboard/Keys/Key.js` L92-104](https://github.com/nickcoutsos/keymap-editor/blob/e7946792cf674db20ab72ab67fea759fff4c3ccc/app/src/Keyboard/Keys/Key.js#L92-L104)）。回転は `transform: rotate()`（[`key-units.js` L26-27](https://github.com/nickcoutsos/keymap-editor/blob/e7946792cf674db20ab72ab67fea759fff4c3ccc/app/src/key-units.js#L26-L27)）。
- **選択ダイアログ**：fuzzysort のあいまい検索で、一致箇所を強調し、↑↓・Enter・Esc で操作できる（[`ValuePicker/index.js` L1-164](https://github.com/nickcoutsos/keymap-editor/blob/e7946792cf674db20ab72ab67fea759fff4c3ccc/app/src/ValuePicker/index.js#L1-L164)）。
- **不満**：
  - コンボの一覧の横に配列を出し、キーを選ぶとそのキーを含むコンボだけに絞りたい（[#378, 2026-10-02](https://github.com/nickcoutsos/keymap-editor/issues/378)）。
  - 2 つ目の引数を押したときに検索欄へフォーカスが移らない（[#226, 2024-06-03](https://github.com/nickcoutsos/keymap-editor/issues/226)）。
  - 「キャンセルが OK に近すぎる」「OK では曖昧」（[#328, 2025-08-14](https://github.com/nickcoutsos/keymap-editor/issues/328)）。
  - 編集中の配列を試し打ちしたい（[#224](https://github.com/nickcoutsos/keymap-editor/issues/224)）。
  - 保存に失敗する（[#131](https://github.com/nickcoutsos/keymap-editor/issues/131)、[#140](https://github.com/nickcoutsos/keymap-editor/issues/140)）。

### 2.6 ZSA Oryx（configure.zsa.io）

ソースは非公開。ZSA の公式ブログを一次情報として使った。

- **一つのキーに 4 つの動作**：Tapped、Held、Double-tapped、Tapped then held。時間の窓（tapping term）は Advanced Settings の「Tapping」で全体にもキー単位にも設定できる（[Tap and Hold Keys Explained, 2024-04-01, 2025-05 更新](https://blog.zsa.io/tap-hold-explained/)）。
- **見た目が同じなら、振る舞いも同じに**：2025-05 以降は、タップとホールドだけのキーをすべて dual-function キーとして生成する。ダブルタップなどを含むキーは Tap Dance として生成する。以前は同じ見た目で効き方が違い、「That's just how it is」としか説明できなかったという（[Dual-function keys now make sense, 2025-05-19](https://blog.zsa.io/tap-hold-update/)）。種類は「Advanced view」で、キーに付く小さな「D」「T」「+」の印で確かめる（[Tap and Hold Keys Explained](https://blog.zsa.io/tap-hold-explained/)）。
- **キーの表示名と、元の打鍵の切り替え**：Cmd+S を送るキーに「Save」と書ける。アイコンも使える。すべての表示名を一度に消して、元の打鍵を見るスイッチがある（[Oryx Changes: I18n, Custom Labels…, 2020-08-25](https://blog.zsa.io/2008-oryx-changes/)）。レイアウトの解説付き公開（Layout Tours）もある（同）。
- **各国語**：Advanced Settings → International で言語のキーコードを有効にする。言語固有のキーは右上に小さく言語名（例「fr」）が付く。キー選択で言語名を検索すると、その言語のカテゴリが出る（[Setting Up International Layouts, 2023-03-07](https://blog.zsa.io/international-setup/)）。
- **コンボ**：サイドバーに一覧があり、項目に乗るとそのキーが配列上で強調される（[Introducing Combos, 2022-12-20](https://blog.zsa.io/2212-combos/)）。当初は「キーが送るもの」でコンボを判定したため、別のレイヤーでも発動した。2026-11 に、物理位置で判定し、効くレイヤーを選べる「Layer-independent Combos」が加わった（[Layer-Independent Combos, 2026-11-09](https://blog.zsa.io/layer-independent-combos/)）。
- **履歴の教訓**：2023-06 にキー単位の履歴（「See past edits made to this key」「Restore Layers」）を入れた。しかし 2023-10 に止めている。理由は、あまり使われなかったこと（既存の「layout revisions」で足りた）と、全操作の記録が全員の性能を落としたことだ（[Introducing Per-Key History, 2023-06-22, 2023-10 更新](https://blog.zsa.io/history/)）。
- **利用者の不満**：公開の課題管理が見当たらず、今回は一次情報を集めていない（未確認）。

### 2.7 Karabiner-Elements（[pqrs-org/Karabiner-Elements](https://github.com/pqrs-org/Karabiner-Elements) `e37fd62`）

キーボードのファームウェアではなく、macOS 側でキーを変えるアプリだ。日本語キーの名付けと、「押して名前を調べる」仕組みの参考になる。

- **Simple Modifications**：対象のデバイスを選び、変える前のキーと後のキーを選ぶ（[docs「Change a key to another key」](https://karabiner-elements.pqrs.org/docs/manual/configuration/configure-simple-modifications/)）。
- **キー選択はカテゴリの入れ子メニュー**で、検索欄はない（[`SimpleModificationPickerView.swift` L11-29](https://github.com/pqrs-org/Karabiner-Elements/blob/e37fd624d00e3f3bd7c84797f683fbf9a46ab7ef/src/apps/SettingsWindow/src/View/SimpleModificationPickerView.swift#L11-L29)）。カテゴリは「このキーを無効にする」「修飾キー」「制御キーと記号」「矢印キー」「英字キー」「数字キー」「Shift + キー」「ファンクションキー」「メディア操作」「テンキー」「PCキーボードのキー」「各国語のキー」「日本語」「マウスボタン」ほか（[`simple_modifications.json`](https://github.com/pqrs-org/Karabiner-Elements/blob/e37fd624d00e3f3bd7c84797f683fbf9a46ab7ef/src/apps/SettingsWindow/Resources/simple_modifications.json)、訳語は [`localization/Resources/settings/key_picker.json`](https://github.com/pqrs-org/Karabiner-Elements/blob/e37fd624d00e3f3bd7c84797f683fbf9a46ab7ef/src/apps/localization/Resources/settings/key_picker.json)）。
- **日本語キーの名前**：`japanese_eisuu` は「ABCキー（英数キー）」、`japanese_kana` は「あいうキー（かなキー）」（[`key_picker.json` L1157-1166](https://github.com/pqrs-org/Karabiner-Elements/blob/e37fd624d00e3f3bd7c84797f683fbf9a46ab7ef/src/apps/localization/Resources/settings/key_picker.json#L1157-L1166)）。PC 用は「PCキーボードの無変換キー／変換キー／かなキー」（同 [L1167-1179](https://github.com/pqrs-org/Karabiner-Elements/blob/e37fd624d00e3f3bd7c84797f683fbf9a46ab7ef/src/apps/localization/Resources/settings/key_picker.json#L1167-L1179)）。`lang1`／`lang2` は「各国語のキー」にあり、名前は `lang1`／`lang2` のまま（同 L1282-1290）。
- **押して名前を調べる**：Karabiner-EventViewer は押したキーのイベントを表示し、キー名を調べられる。表示は変換後の値なので、元のイベントを見る「Capture Raw Input Events」もある（[docs「EventViewer」](https://karabiner-elements.pqrs.org/docs/manual/operation/eventviewer/)）。
- **JIS では刻印とキー名がずれる**：キー名は HID の用途名で、ANSI 配列の物理位置に近い。そのため JIS の「@」は `open_bracket`、「`[`」は `close_bracket`、「_」は `international1` になる。公式は「意図した動作」とし、自分の配列に合うキー名を使うよう求めている（[docs「Input symbols are different from the key code name on non-ANSI keyboards」](https://karabiner-elements.pqrs.org/docs/help/troubleshooting/symbols-with-non-ansi-keyboard/)）。
- **Complex Modifications**：条件付きのルールを、コミュニティのルール集から取り込むか、自分で書いて有効にする（[docs「Use more complex modifications」](https://karabiner-elements.pqrs.org/docs/manual/configuration/configure-complex-modifications/)）。
- **不満**：ISO 配列の設定で ^ と < が入れ替わり、ANSI や JIS にすると直るという報告（[#4070, 2024-12-20](https://github.com/pqrs-org/Karabiner-Elements/issues/4070)）。刻印・OS の配列設定・キー名の三者がずれると、利用者には原因が見えない。

### 2.8 Keyball Link（[Yowkees/keyball-link](https://github.com/Yowkees/keyball-link) `6f6b1fb`）

- **対象と通信**：Keyball39/44/61/+ 専用。WebHID で通信し、専用ファームウェアを使う（[README](https://github.com/Yowkees/keyball-link/blob/6f6b1fbe70f91d682fefe0946309f4500d0c7637/README.md)）。アプリは keyball-link.shiroganelab.com（同 README）。
- **トップのタブ**：キーマップ／トラックボール設定／マクロ拡張／詳細設定／ファームウェア／タイピングゲーム／ご意見・要望（本番バンドルの文言、`App.tsx`）。
- **配列**：Remap と同じく via.json の KLE 座標で描く。傾いた親指キーは CSS 変数で角度を渡す（[`src/components/KeyboardLayout/Key.tsx` L17, L47-48](https://github.com/Yowkees/keyball-link/blob/6f6b1fbe70f91d682fefe0946309f4500d0c7637/src/components/KeyboardLayout/Key.tsx#L17-L48)）。キーは `<button>` で、絵からキーコードをドロップできる（同 [L52-78](https://github.com/Yowkees/keyball-link/blob/6f6b1fbe70f91d682fefe0946309f4500d0c7637/src/components/KeyboardLayout/Key.tsx#L52-L78)）。凡例は主表示と、シフト時の文字（`key__shift`）の二段（同 L70-77）。Layer-Tap は「タップのキー」と「`L` ＋番号」、Mod-Tap は「タップのキー」と修飾名を 2 行で書く（[`src/lib/keycodes.ts` L439-457](https://github.com/Yowkees/keyball-link/blob/6f6b1fbe70f91d682fefe0946309f4500d0c7637/src/lib/keycodes.ts#L439-L457)）。レイヤーは名前ではなく番号で出る。
- **ボール**：ボール側のキー位置は描かず（[`Key.tsx` L39, L50](https://github.com/Yowkees/keyball-link/blob/6f6b1fbe70f91d682fefe0946309f4500d0c7637/src/components/KeyboardLayout/Key.tsx#L39-L50)）、その領域に、周りのキーに重ならない大きさの円を計算して `kb-ball` ボタンとして置く（[`KeyboardLayout.tsx` L92-156, L251-255](https://github.com/Yowkees/keyball-link/blob/6f6b1fbe70f91d682fefe0946309f4500d0c7637/src/components/KeyboardLayout/KeyboardLayout.tsx#L92-L156)）。円にはそのレイヤーでの働き（カーソル／スクロール／精密／ジェスチャー）を書き、押すとボール設定が開く。左右の切り替えには「ボール（自動）」（キーボードから読んだ位置）もある（バンドルの文言「トラックボール（レイヤー{0}）: {1}（クリックで設定）」）。
- **説明欄**：キーに乗ると、平易な日本語で働きを説明する。例「透過：下のレイヤーのキーがそのまま使われます」（[`src/lib/keycodes.ts` L519](https://github.com/Yowkees/keyball-link/blob/6f6b1fbe70f91d682fefe0946309f4500d0c7637/src/lib/keycodes.ts#L519)）、「タップ：{0} を入力 ／ 長押し：{1} として動作します」（同 [L719](https://github.com/Yowkees/keyball-link/blob/6f6b1fbe70f91d682fefe0946309f4500d0c7637/src/lib/keycodes.ts#L719)）。表示欄は配列の下（[`KeyboardLayout.tsx` L267](https://github.com/Yowkees/keyball-link/blob/6f6b1fbe70f91d682fefe0946309f4500d0c7637/src/components/KeyboardLayout/KeyboardLayout.tsx#L267)）。
- **レイヤー**：`L0` などの番号に色の点を付けたタブ。タブをドラッグして並べ替え、「🔀 並べ替えをプレビュー中です。『保存』で確定します（レイヤー切替キーの番号も自動で調整されます）」と出す。並べ替え中はキーを編集できない。「全レイヤー」ですべてを縦に並べ、同じ位置のキーを見比べられる。キーを押すとそのレイヤーへ移る（[`App.tsx` L1087-1144](https://github.com/Yowkees/keyball-link/blob/6f6b1fbe70f91d682fefe0946309f4500d0c7637/src/App.tsx#L1087-L1144)）。
- **キー設定パネル**：「通常／ホールド／カスタム」の 3 枚（[`KeyConfigModal.tsx` L13](https://github.com/Yowkees/keyball-link/blob/6f6b1fbe70f91d682fefe0946309f4500d0c7637/src/components/KeyConfigModal/KeyConfigModal.tsx#L13)）。
  - 通常：検索とカテゴリ（すべて、文字/数字、記号、操作、F/テンキー、日本語、レイヤー、マウス、メディア、マクロ、特殊）。同 [L34-39](https://github.com/Yowkees/keyball-link/blob/6f6b1fbe70f91d682fefe0946309f4500d0c7637/src/components/KeyConfigModal/KeyConfigModal.tsx#L34-L39)。検索結果は矢印キーで移動できる（`useKeySearchNav.ts`）。
  - ホールド：「ホールド時の動作：修飾キー／レイヤー切替」を選び、タップのキーを選ぶ（同 [L444-](https://github.com/Yowkees/keyball-link/blob/6f6b1fbe70f91d682fefe0946309f4500d0c7637/src/components/KeyConfigModal/KeyConfigModal.tsx#L444)）。修飾キーを付けられないキーでは理由を出す（同 [L270](https://github.com/Yowkees/keyball-link/blob/6f6b1fbe70f91d682fefe0946309f4500d0c7637/src/components/KeyConfigModal/KeyConfigModal.tsx#L270)）。
  - カスタム：16 進数のキーコードを直接入力すると「解釈：」を返す（同 [L488-530](https://github.com/Yowkees/keyball-link/blob/6f6b1fbe70f91d682fefe0946309f4500d0c7637/src/components/KeyConfigModal/KeyConfigModal.tsx#L488-L530)）。
- **日本語と OS**：
  - 「LANG1(かな)/Mac推奨」「LANG2(英数)/Mac推奨」「かな(JIS)」のように、同じ名前のキーを用途で書き分ける（バンドルの文言）。
  - 「キー表示の配列設定」で凡例を JIS/US に切り替える。説明は「表示だけで、実際に入力される文字は変わりません」（[`SettingsTab.tsx` L151](https://github.com/Yowkees/keyball-link/blob/6f6b1fbe70f91d682fefe0946309f4500d0c7637/src/components/SettingsTab/SettingsTab.tsx#L151)、文言はバンドル）。
  - 「OSに合わせて ⌘(Cmd) と Ctrl を自動で入れ替える」（同 [L102](https://github.com/Yowkees/keyball-link/blob/6f6b1fbe70f91d682fefe0946309f4500d0c7637/src/components/SettingsTab/SettingsTab.tsx#L102)）。
  - macOS が Keyball を US 配列と誤認する問題には、ターミナルに貼るコマンドを出す（README「macOSで @ などの記号が正しく入力できない場合」）。
- **保存と取り消し**：Cmd/Ctrl+Z と Cmd/Ctrl+Shift+Z（[`App.tsx` L395, L960](https://github.com/Yowkees/keyball-link/blob/6f6b1fbe70f91d682fefe0946309f4500d0c7637/src/App.tsx#L395)）。「未保存の変更があります」と「● 保存する」（同 [L981](https://github.com/Yowkees/keyball-link/blob/6f6b1fbe70f91d682fefe0946309f4500d0c7637/src/App.tsx#L981)）。JSON の書き出しと読み込みもある。
- **ARIA**：ソース中の `role` は設定画面のカードの `tablist`／`tab` だけ（[`SettingsBoard.tsx` L28-32](https://github.com/Yowkees/keyball-link/blob/6f6b1fbe70f91d682fefe0946309f4500d0c7637/src/components/SettingsBoard/SettingsBoard.tsx#L28-L32)）。レイヤーのタブは `role` のない `<button>` で、`App.tsx` を見た範囲ではドラッグ以外の並べ替え手段がない。
- **利用者の声**（[Issues](https://github.com/Yowkees/keyball-link/issues)、[Discussions](https://github.com/Yowkees/keyball-link/discussions)）：
  - 書き出した JSON にコンボが入っていない（[#13, 2026-11-03](https://github.com/Yowkees/keyball-link/issues/13)）。
  - テンキーの説明が一つずれている（[#20](https://github.com/Yowkees/keyball-link/issues/20)）。
  - CPI が電源を切ると戻る。あわせて「xc で左クリック、vc で右クリック」のようにマウス操作をコンボに置きたいという要望（[#21, 2026-11-19](https://github.com/Yowkees/keyball-link/issues/21)）。
  - Discussions には「ホールド時に複数の修飾キーを割り当てられますか」「レイヤーを増やしたい」「アカウントを使ってレイアウトを共有したい」がある（[#7](https://github.com/Yowkees/keyball-link/discussions/7)、[#5](https://github.com/Yowkees/keyball-link/discussions/5)、[#11](https://github.com/Yowkees/keyball-link/discussions/11)）。

### 2.9 共通して見える長所と不満

**長所として引き継ぐもの**

- 物理キーを押して割り当てる（QMK Configurator）。
- 平易な日本語でキーの働きを説明する（Keyball Link）。
- 全レイヤーの比較と、番号を追従させる並べ替えプレビュー（Keyball Link）。
- 名前付きレイヤーと、undo/redo・Save/Discard（ZMK Studio）。
- 凡例をホスト配列に合わせる（QMK Configurator、Keyball Link）。
- あいまい検索と、キーボードだけで選べるダイアログ（keymap-editor）。
- 「同じに見えるキーは同じに効く」ように生成側を揃える。独自の表示名と、元の打鍵を見るスイッチ（Oryx）。
- 押したキーの名前を調べる道具と、刻印とキー名のずれの説明（Karabiner-Elements）。

**作り込みすぎた例**：Oryx はキー単位の操作履歴を入れたが、あまり使われず性能を落としたため止めた。版（revisions）単位で戻せれば足りた（2.6）。Keyballer では git の履歴がこの版に当たる。

**繰り返し出る不満**

| 不満 | 例 |
| --- | --- |
| キャップを見ても何のキーか分からない（片側だけ、空白、コード文字列） | ZMK Studio #147 #148、VIA の文字列表示 |
| レイヤーが番号でしか呼べない | VIA #106 |
| コンボが作れない、または一覧が長すぎて配列と結びつかない | QMK Configurator #1154、VIA #248、Vial #354、keymap-editor #378 |
| 検索が言葉の付け方のせいで効かない | ZMK Studio #151、QMK Configurator #1372 |
| ファームウェアが受け付けない組み合わせを UI が止めない | QMK Configurator #1007、Vial #232 |
| 取り消しがない、保存の結果が分からない | Vial #373、keymap-editor #131 #140 |
| 画面の状態とファイルが別れる、書き出しに欠けがある | ZMK Studio ドキュメント・#124、Keyball Link #13 |

---

## 3. 題材に根ざした設計の手がかり

### 3.1 物理配列：どこから座標を取るか

- **QMK `info.json`**：各キーは `x` `y` `w` `h` を持つ。`r` `rx` `ry` は書けるが「Currently not implemented」とされている（[QMK docs `reference_info_json.md` L366-396](https://github.com/qmk/qmk_firmware/blob/80973aa0b5413e9a5bbbf9293507f39e870f9aa3/docs/reference_info_json.md#L366-L396)）。同じ項目には `hand`（Chordal Hold 用の `"L"`／`"R"`）もあり、分割キーボードの左右を表せる。
- **Keyball39 の `info.json` は格子**。`LAYOUT_no_ball` の 42 キーは整数座標の格子で、列のずれも回転もない（[Yowkees/keyball `keyball39/info.json`](https://github.com/Yowkees/keyball/blob/4664de991d14da34bd42e7031ac7406b6ccb02af/qmk_firmware/keyboards/keyball/keyball39/info.json)）。
- **Keyball39 の `via.json` は実物に近い**。KLE 形式で列ごとの縦ずれを持ち、親指キーに `r: 10, 20, -20, -10` の回転がある（[`via.json` L33-36](https://github.com/Yowkees/keyball/blob/4664de991d14da34bd42e7031ac7406b6ccb02af/qmk_firmware/keyboards/keyball/keyball39/via.json#L33-L36)）。レイアウトの選択肢に「Ball availability: None, Right, Left, Dual」がある（同 L7-9）。この commit は Keyballer の README の例が固定している `ref` と同じだ。Keyball Link もこのファイルから描いている（2.8）。
- **ZMK の physical layout**：`<&key_physical_attrs w h x y r rx ry>` を centi 単位（1u＝100、角度は 1/100 度）で書く。ZMK Studio で必須（[zmk `docs/docs/hardware-integration/physical-layouts.md` L42-63](https://github.com/zmkfirmware/zmk/blob/4de313367288aad5aeaa1243890e40dc813f7008/docs/docs/hardware-integration/physical-layouts.md#L42-L63)）。
- **keymap-drawer** は QMK 形式の `x` `y` `r` `rx` `ry` だけを使う。`rx` `ry` を省いたときの回転中心がツールによって違う（keymap-drawer はキーの中心、KLE はキーの左上）ので、明示を勧めている（[`PHYSICAL_LAYOUTS.md` L36, L55-58](https://github.com/caksoylar/keymap-drawer/blob/467abe2a2fee3a1ec1658d8c3fe33d1cc562b53c/PHYSICAL_LAYOUTS.md#L36-L58)）。

**Keyballer への示唆**

- 内部の座標モデルは `x y w h r rx ry`（KLE／ZMK と同じ意味）に揃える。回転中心は常に明示する。
- Keyball は `via.json` から、ZMK 機（roBa、meteorite40）は physical layout から読み込む。
- 左右の手（`hand`）と、分割の隙間を持たせる。ボールの位置はレイアウトの選択肢として持つ。

### 3.2 トラックボールを配列の一部として描く

- Keyball の配列定義は、ボールの有無と左右をレイアウトの選択肢として持っている（3.1）。
- Keyball Link は、ボールが占めるキー位置を描かず、その空きに周りのキーと重ならない円を置き、押せる対象にしている（2.8）。同じ円に「カーソル」「スクロール」などそのレイヤーでの働きを書く。オートマウスレイヤーのときは「オートマウス」と表示する（バンドルの `layer-toolbar__aml`）。
- Keyballer の README は、今後の項目として「トラックボール（物理単位での感度設定・校正）」を挙げている（[README.ja.md「これから」L134-138](https://github.com/AkiraMisawa/keyballer/blob/a963c8b5256cc8060ab7c7979215953a6dbc8059/README.ja.md#L134-L138)）。

**Keyballer への示唆**

- ボールは配列と同じ縮尺で、キーと同じ層に描く。依頼にある 34 mm を実寸比で描けるかは、1u を何 mm とみなすかに依存する。未検証。
- 円の中には、そのレイヤーでのボールの働きを書く（カーソル／スクロール／なし）。円を選ぶとボール設定を開く。
- オートマウスで自動的に入るレイヤーは、レイヤータブとボールの両方に印を付ける。

### 3.3 キーキャップの凡例

**keymap-drawer の慣習**（自作キーボードの配列図で広く使われる）

- 位置の意味：`tap` は中央、`hold` は下、`shifted` は上。ほかに左右と四隅も使える（[`KEYMAP_SPEC.md` L57-77](https://github.com/caksoylar/keymap-drawer/blob/467abe2a2fee3a1ec1658d8c3fe33d1cc562b53c/KEYMAP_SPEC.md#L57-L77)）。
- キーの種類：`held` は「押さえているキー」を赤く塗る。`ghost` は点線の枠で、任意のキー。`trans` は薄い文字の透過キー（同 L73）。
- 透過キーの既定の凡例は `▽`（[`CONFIGURATION.md` L296-302](https://github.com/caksoylar/keymap-drawer/blob/467abe2a2fee3a1ec1658d8c3fe33d1cc562b53c/CONFIGURATION.md#L296-L302)）。sticky と toggle はホールドの位置に `sticky`／`toggle` と書く（同 L272-294）。
- `held` は、そのレイヤーに入るために押さえているキーを、行き先のレイヤーの図に付ける（[`keymap_drawer/parse/parse.py` L115-153](https://github.com/caksoylar/keymap-drawer/blob/467abe2a2fee3a1ec1658d8c3fe33d1cc562b53c/keymap_drawer/parse/parse.py#L115-L153)）。
- 既定の配色：キーは `#f6f8fa`、コンボは青 `#cdf`、held は `#fdd`。ホールドとシフトの文字はタップより小さい 11px（[`config.py` L108-166](https://github.com/caksoylar/keymap-drawer/blob/467abe2a2fee3a1ec1658d8c3fe33d1cc562b53c/keymap_drawer/config.py#L108-L166)）。

**既存ツールとの対比**

- VIA は文字列をそのまま、ZMK Studio は名前と第 1 引数だけを出す（2.2、2.4）。Vial は上下の分割、QMK Configurator は入れ子の枠、Keyball Link は 2 行（2.1、2.3、2.8）。
- 片側だけ、空白、文字列という表示が不満の筆頭だ（2.9）。

**Keyballer への示唆**

- **中央にタップ、下にホールド**。ホールドは役割の言葉で書く（`Ctrl`、`⌥`、`L1 記号`）。レイヤーには番号ではなく名前を使い、keymap-drawer の `layer_legend_map` と同じ考え方をとる（[`CONFIGURATION.md` L304-312](https://github.com/caksoylar/keymap-drawer/blob/467abe2a2fee3a1ec1658d8c3fe33d1cc562b53c/CONFIGURATION.md#L304-L312)）。
- **JIS 記号は上段にシフト時の文字**。Keyball Link と同じ二段表示にする。
- **透過キーは `▽` に加え、実際に落ちていく先のキーを薄く描く**。ふつうは下のレイヤーのキーで、計算で求められる。「何もしない」（`KC_NO`）は `▽` と区別し、別の印にする。
- **行き先レイヤーには、押さえているキーの印を付ける**。keymap-drawer の `held` と同じ意味にする。色だけに頼らず、輪郭の形も変える（WCAG 1.4.1。4.3 参照）。
- **色は状態だけに使う**。修飾、レイヤー、マウスなどのキーの種類は、色ではなく凡例の位置と言葉で示す。色を使うのは「選択中」「差分あり」「held」の 3 状態に限る。

### 3.4 レイヤーの移動と比較

- **名前**：VIA の不満（#106）。ZMK Studio は名前変更に対応する（2.4）。ZMK のキーマップはレイヤーに `display-name` を持てる（keymap-drawer はこれをノード名より優先する。[README L107-108](https://github.com/caksoylar/keymap-drawer/blob/467abe2a2fee3a1ec1658d8c3fe33d1cc562b53c/README.md#L107-L108)）。QMK の `keymap.c` には名前の欄がない。名前は enum や `#define` から推測するか、Keyballer 側の設定に持つことになる。
- **比較**：Keyball Link の「全レイヤー」（2.8）。keymap-drawer の `n_columns` は、複数レイヤーを横に並べる（[`CONFIGURATION.md` L51-55](https://github.com/caksoylar/keymap-drawer/blob/467abe2a2fee3a1ec1658d8c3fe33d1cc562b53c/CONFIGURATION.md#L51-L55)）。
- **並べ替え**：Keyball Link は、`LT()` などの番号を自動で付け替えることをプレビューで示してから保存する（2.8）。ZMK Studio はリストのドラッグで並べ替える（2.4）。

**Keyballer への示唆**

- タブには名前を表示する。並べ替えには、ドラッグに加えて「上へ／下へ」のボタンを付ける（WCAG 2.5.7）。
- 「このキー位置を全レイヤーで見る」縦の帯を用意する。選んだキーの、レイヤーごとの割り当てを並べる。
- タブの横に、そのレイヤーへの入り方（例「親指 Tab 長押し」）を書く。

### 3.5 コンボとタップホールドの見せ方

- **keymap-drawer のコンボ**：
  - 位置：トリガーキーの中点（`mid`）か、上下左右に箱を置く。
  - 線：離れているときは各キーへ線（dendron）を引く（[`KEYMAP_SPEC.md` L99-123](https://github.com/caksoylar/keymap-drawer/blob/467abe2a2fee3a1ec1658d8c3fe33d1cc562b53c/KEYMAP_SPEC.md#L99-L123)）。
  - 別図：レイヤーとは別の小さな図に分けることもできる（`separate_combo_diagrams`、[`CONFIGURATION.md` L61-69](https://github.com/caksoylar/keymap-drawer/blob/467abe2a2fee3a1ec1658d8c3fe33d1cc562b53c/CONFIGURATION.md#L61-L69)）。
  - キー番号：ZMK の `key-positions` と同じ数え方を使う（`KEYMAP_SPEC.md` 脚注 5）。
- **利用者の要望**：
  - QMK Configurator：キーの間に小さなキーを置く案（#1154）。
  - keymap-editor：キーで絞る（#378）。
  - Vial：表で見る（#354）。
  - Keyball Link：マウス操作をコンボにしたい（#21）。
- **Oryx**：一覧の項目に乗ると、そのコンボのキーが配列上で光る。2026-11 には、判定を「キーが送るもの」から「物理位置」に変え、効くレイヤーを選べる設定が加わった（2.6）。QMK の `COMBO_ONLY_FROM_LAYER`（他のレイヤーが有効でも、コンボのキーを常に指定のレイヤーで判定する。[QMK docs `features/combo.md` L366](https://github.com/qmk/qmk_firmware/blob/80973aa0b5413e9a5bbbf9293507f39e870f9aa3/docs/features/combo.md#L366)）と同じ問題意識だ。
- **所有者のキーマップ**：
  - コメントに「`COMBO_ONLY_FROM_LAYER` makes them position based」とある（`keymap.c` L84）。
  - 隣り合うキーのコンボを右手に 3 つ持つ（`M`＋`BTN1`→`,`、`BTN1`＋`BTN2`→`.`、`BTN2`＋`RSFT_T(/)`→`\`）。マウスボタン自体が基本レイヤーのキーだ（ローカルの `AkiraMisawa/keyball` ブランチ `am338` `683f8fc`、`qmk_firmware/keyboards/keyball/keyball39/keymaps/am338/keymap.c` L83-92、L53）。
  - タップホールドはキーごとに調整している。`LT(1,KC_TAB)` などは hold-on-other-key-press（同 L102-114）。Windows では英数／かなキーの tapping term を 0 にする（同 L116-125）。

**Keyballer への示唆**

- コンボは配列の上、トリガーキーの間に小さな箱で描く。箱は出力キーの凡例を持ち、選ぶと編集できる。
- コンボが 10 個を超えたら一覧に切り替え、配列でキーを選ぶと、そのキーを含むコンボに絞り込めるようにする。
- 出力キーのないコンボは保存させない（Vial #232）。
- キーごとのタップホールド設定（tapping term、hold-on-other-key-press、OS 依存）は、キャップの隅に小さな印を付け、詳細パネルで値と出どころ（データかコードか）を示す。

### 3.6 キーコードの検索と選択（日本語・JIS・Mac/Windows）

**名前が三重になっている**

| 刻印・用途 | QMK | ZMK | `KeyboardEvent.code` |
| --- | --- | --- | --- |
| ろ（`\` `_`） | `JP_BSLS` = `KC_INT1` | `INT_RO` = `INT1` | `IntlRo` |
| カタカナ/ひらがな | `JP_KANA` = `KC_INT2` | `INT_KATAKANAHIRAGANA` | `KanaMode` |
| ¥ | `JP_YEN` = `KC_INT3` | `INT_YEN` | `IntlYen` |
| 変換 | `JP_HENK` = `KC_INT4` | `INT_HENKAN` | `Convert` |
| 無変換 | `JP_MHEN` = `KC_INT5` | `INT_MUHENKAN` | `NonConvert` |
| 英数（Windows JIS） | `JP_EISU` = `KC_CAPS` | — | — |
| かな（Mac） | `KC_LNG1` | `LANG1` | `Lang1` |
| 英数（Mac） | `KC_LNG2` | `LANG2` | `Lang2` |

出典：[QMK `keymap_japanese.h` L37-111](https://github.com/qmk/qmk_firmware/blob/80973aa0b5413e9a5bbbf9293507f39e870f9aa3/quantum/keymap_extras/keymap_japanese.h#L37-L111)、[ZMK `keys.h` L629-678](https://github.com/zmkfirmware/zmk/blob/4de313367288aad5aeaa1243890e40dc813f7008/app/include/dt-bindings/zmk/keys.h#L629-L678)、[W3C UI Events KeyboardEvent code Values](https://www.w3.org/TR/uievents-code/)（`Lang1` は「Japanese (Mac keyboard): かな」、`Lang2` は「英数」）。

- **刻印とキー名はずれる**。キーコードの名前は US（ANSI）配列の物理位置に由来するので、JIS では刻印と合わない。Karabiner の公式文書は、JIS の「@」が `open_bracket`、「_」が `international1` になることを表で示している（2.7）。QMK も同じで、`JP_BSLS` の実体は `KC_INT1` だ（上表）。
- **OS 対応表は鵜呑みにしない**。QMK のキーコード表は `KC_LNG1`／`KC_LNG2` の macOS 欄に印を付けていない（[`docs/keycodes.md` L11, L155-156](https://github.com/qmk/qmk_firmware/blob/80973aa0b5413e9a5bbbf9293507f39e870f9aa3/docs/keycodes.md#L155-L156)）。しかし W3C の表は Mac のかな／英数を `Lang1`／`Lang2` としている。Keyball Link も「Mac推奨」と書き、所有者のキーマップも Mac の英数／かなに `KC_LNG2`／`KC_LNG1` を使う（`keymap.c` L41-42）。
- **検索の言葉が成否を分ける**。ZMK Studio は全キーに「Keyboard」を前置したため検索が効かなかった（#151）。QMK Configurator は、選んだ OS 配列を検索が無視した（#1372）。
- **Mac と Windows で意味が変わるキーがある**。所有者のキーマップでは、Q の長押しが Mac で Cmd、Windows で Alt になる。スクリーンショットのキーは Mac が `LSG(KC_4)`、Windows が `LSG(KC_S)`（`keymap.c` L134-141, L190）。

**Keyballer への示唆**

- 検索の対象：刻印（`ろ`、`¥`）、日本語名（英数、かな、変換、無変換、半角/全角）、ローマ字読み（eisu、kana、henkan）、QMK／ZMK の名前と別名（`JP_EISU`、`KC_LNG2`、`LANG2`）、英語名。
- 結果の各行：凡例、日本語の説明、ファームウェアごとの正式名、OS ごとの注意（例「Mac では英数」「Windows では CapsLock」）を一行に出す。
- 表示の切り替え：凡例は JIS／US、Mac／Windows を上部で切り替える。Keyball Link と同じく「表示だけが変わる」と書く。
- カテゴリの切り方：Keyball Link の分け方（文字/数字、記号、操作、F/テンキー、日本語、レイヤー、マウス、メディア、マクロ）は日本語で考える人に合っている。トラックボール系（CPI、スクロール、オートマウス）は、マウスと同じ群かその隣に置く。
- 入れられない組み合わせ：`LT()`／`MT()` にはシフト記号や修飾付きキーを入れられない（QMK docs）。候補を灰色にし、理由を書く（Keyball Link の「修飾キーと組み合わせできません」と同じ）。

### 3.7 キーボードで割り当てる

- **前例**：QMK Configurator は、選択中のキーにパソコンのキーで割り当てる（2.1）。Karabiner-EventViewer は、押したキーの名前を表示する。変換後の値と元の値を分けて見せる（2.7）。
- **`code` を使う**：W3C の `KeyboardEvent.code` は物理位置を表し、配列や IME の影響を受ける `key` とは別物だ（[UI Events KeyboardEvent code Values「Abstract」](https://www.w3.org/TR/uievents-code/)）。Mac のかな／英数は `Lang1`／`Lang2` で届く（同表）。
- **IME 変換中は除く**：変換中のキー入力は `isComposing` が真になる（[UI Events §3.6.5 Key Events During Composition](https://www.w3.org/TR/uievents/)）。
- **ショートカットの地域差**：Vercel の Web Interface Guidelines は、QWERTY 以外の配列に合わせてショートカットを国際化し、OS ごとの記号を出すよう勧める（[README L35](https://github.com/vercel-labs/web-interface-guidelines/blob/434b7f91364665f2f733b310ec54809bf8f37937/README.md#L35)）。

**Keyballer への示唆**

- 「キーを押して割り当て」は明示的なモードにする。ボタンで入り、画面に「次に押したキーを {位置} に割り当てます」と出す。
- 抜ける方法は二つ用意する。Esc 自体を割り当てたい場合があるので、モードを抜けるボタンを別に置き、Esc は 2 回押しで抜ける、などにする。
- `code` から QMK／ZMK のキーコードに変換する。`isComposing` の間は無視する。OS が横取りするキー（Cmd+Tab など）は取れないので、一覧から選ぶよう案内する。

### 3.8 OS 依存と「コードで書かれた部分」

所有者の `am338` は、GUI でそのまま表せない書き方を多く含む。

- `os_detection` による Mac 判定（`keymap.c` L31, L45, L226-235）。
- OS で変わるキー（L134-141, L162, L190, L197, L210）。
- キーごとのタップホールド調整（L102-125）。

他のツールの扱いは二通りだ。ZMK Studio はファイルから離れてキーボード内に状態を持つ（2.4）。QMK Configurator は JSON しか扱わない。どちらも、手書きのコードと GUI を両立させていない。

**Keyballer への示唆**

- 編集するのは `keymaps[]` の各要素、コンボ表、タップダンス表などのデータ部分だけにする。それ以外のコードは一字も変えずに残し、保存前に差分で確かめる（3.9）。
- コードで振る舞いが変わるキー（`process_record_user` に `case` があるキーなど）には、キャップの隅に印を付ける。詳細パネルでは該当行を示し、GitHub の該当行へのリンクを付ける。
- 解析できない書き方（マクロ展開、条件付きコンパイル）に当たったら、そのキーは読み取り専用にする。「このキーはコードで定義されています」と言い切り、推測で書き換えない。
- `is_mac` で分岐するキーは、Mac／Windows の表示切り替え（3.6）で両方の凡例を確かめられるようにする。ここは解析の精度に依存するので、試作で確かめる。

### 3.9 commit の前に差分を見せる

- **前例**：
  - keymap-editor は差分を見せず、固定のメッセージ「Updated keymap」で commit する（2.5）。
  - ZMK Studio と Keyball Link は、undo/redo と未保存表示を持つ（2.4、2.8）。Keyball Link のレイヤー並べ替えは「プレビュー → 保存／取り消し」の二段だ。
  - Oryx は「layout revisions」で版を残す。キー単位の操作履歴は使われずに止めた（2.6）。
  - Vercel の指針：破壊的な操作は確認か Undo を付ける。保存中などの表示は「…」で終える（[README L19-20](https://github.com/vercel-labs/web-interface-guidelines/blob/434b7f91364665f2f733b310ec54809bf8f37937/README.md#L19-L20)）。
- **Keyballer で使える既存の土台**：GitHub の commit と Actions のビルド状態。後者は今の画面がすでに表示している。

**Keyballer への示唆**

1. 変更のたびに、そのキーに「差分あり」の印を付ける。タブには変更数を出す（例「記号 3」）。
2. 「commit する」を押すと、変更の確認画面になる。
   - 左：配列図。変わったキーだけを、旧→新の凡例で示す。
   - 右：`keymap.c`（または `.keymap`）の統一差分。データ部分以外に差分がないことを一目で確かめられるようにする。
3. コミットメッセージは変更内容から下書きし、編集できるようにする（例「L0: Q を Alt/Q に、親指 2 番を ⌥/英数 に」）。ボタンの名前は最後まで同じにする（「commit する」→「commit しました」。[frontend-design L67](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md#L67)）。
4. 読み込んだときの commit SHA と、ブランチの今の先頭を比べる。違えば止め、取り込み直すかどうかを聞く。
5. commit した後は、既存のビルド状態の表示につなげる（「ビルド中」→「書き込む」）。

---

## 4. 作る前・作った後の確認方法

### 4.1 作る前に書くもの

frontend-design の二段階の手順（1.4）を、この画面向けに具体化する。

1. **画面の役割を一文で書く**。例「自分のキーボードの配列図を見ながら、1 キーずつ確かめて変え、差分を見て commit する」。
2. **状態の一覧を書く**。
   - リポジトリ：未接続／読み込み中／キーマップが見つからない／解析できない箇所がある。
   - 編集：未保存の変更あり／commit 中／先頭が進んでいて衝突。
   - 機種と環境：ZMK で物理配列がない／オフライン／API 制限。
   - Kosta と impeccable は、ここが抜けることを名指ししている（1.2）。
3. **配色と書体の案を書く**。4〜6 色に名前を付ける（例：キー地、キー縁、凡例、ホールド文字、選択＝ボールの赤、差分あり）。書体と役割（和文本文、キャップの凡例、コード）。ASCII のワイヤーフレームを 2 案。
4. **似た依頼と比べる**。「キーマップエディタを作って」とだけ頼んだときの出力と、案を並べる。同じになった部分は理由を書いて直す（[frontend-design L53](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md#L53)）。

### 4.2 スロップ点検表

| 確認すること | 確認方法 | 根拠 |
| --- | --- | --- |
| 画面の最初に目に入るのが配列図か | 開いて 3 秒で目が行く場所を書き出す | frontend-design L17、Kosta |
| カードの格子・同じ角丸・同じ影の繰り返しがないか | 角丸と影の値を CSS から一覧にし、用途ごとに違うか見る | frontend-design L42、impeccable L25 |
| 見出しの上の小ラベル、大文字ラベル、中黒区切り、「→」付きボタンがないか | 文言を全部抜き出して目で見る | frontend-design L25-28, L43 |
| 等幅フォントがコードと数値以外に使われていないか | `font-family` の使用箇所を grep | frontend-design L43、impeccable L38 |
| 絵文字や記号がアイコンの代わりになっていないか | 文言の抽出結果から記号を探す | impeccable L40 |
| 動きが「答える動き」だけか（開く、確定、差分の点灯） | ホバーや入場の動きを全部止めて、困るものだけ戻す | frontend-design L32 |
| 赤が「選択」と「ボール」以外に使われていないか | スクリーンショットで赤の箇所を数える | 1.5 |
| ボタン名が結果を言っているか、操作名が最後まで同じか | 「commit する」→確認画面→完了表示を通して読む | frontend-design L67 |
| エラーが原因と直し方を言っているか、謝っていないか | 状態一覧の各エラーを表示させて読む | frontend-design L69 |
| 空・読み込み・エラー・衝突の画面があるか | 4.1 の状態一覧を一つずつ表示させる | Kosta 5 項 |
| 選択色、フォーカスリング、スクロールバー、数字の揃えが設計されているか | 実際に選択・Tab 移動・長いリストを出す | impeccable L15 |
| 他のツールの画面と並べて、どれか言い当てられるか | VIA、ZMK Studio、Keyball Link のスクリーンショットと並べて第三者に見せる | 1.1 |

### 4.3 アクセシビリティの点検

**部品と APG パターン**

| 部品 | 使うパターン | 要点 |
| --- | --- | --- |
| 配列図のキー群 | [APG Grid の Layout Grid](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) | タブ順に入るのは 1 つだけで、矢印キーで移動する。行のない配置には、左右それぞれで上段・中段・下段・親指の論理行を決める。各キーの名前は「左手 中段 1 番目：タップ A、長押し Ctrl」のように、位置と割り当ての両方を言う |
| レイヤーの切り替え | [APG Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) | 左右の矢印で移動する。パネルの表示が遅れなければ自動で切り替えてよい |
| キーの検索 | [APG Combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)（入力で候補を絞る editable 型） | 候補はリストボックス。ZMK Studio は react-aria の ComboBox を使っている |
| カテゴリ内の候補 | [APG Listbox](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/) | タイプアヘッドをすべてのリストボックスに、特に 7 項目を超えるものに勧めている |
| レイヤーの並べ替え | Listbox の並べ替え例（Rearrangeable Options） | ドラッグ以外に「上へ／下へ」を付ける |

**WCAG 2.2 の基準と、この画面での当てはめ**（[WCAG 2.2](https://www.w3.org/TR/WCAG22/)）

- **1.4.3 Contrast (Minimum)**：文字は 4.5:1、大きな文字は 3:1。ホールドの小さい凡例と、透過キーの薄い凡例が対象になる。keymap-drawer の既定の透過文字 `#7b7e81` はキー地 `#f6f8fa` に対して 3.84:1 で、14px の文字には足りない（今回の計算）。
- **1.4.11 Non-text Contrast**：UI 部品の状態を示す視覚情報は 3:1。Keyballer の今の枠線 `--border #d5dade` は、白地に対して 1.41:1（暗色時 `#2f373e` 対 `#1e2328` は 1.31:1）。キーの「選択中」「held」「差分あり」を枠や塗りで示すなら、別の値が要る（今回の計算）。
- **1.4.1 Use of Color**：held、差分、コンボを色だけで区別しない。形（実線／点線／二重線）か文字を併用する。
- **2.1.1 Keyboard**：すべての操作をキーボードでできること。Vial のレイヤーボタンは NoFocus だった（2.3）。
- **2.5.7 Dragging Movements**（2.2 で新設）：ドラッグする操作は、ドラッグなしの単一ポインタでもできること。キーコードのドロップ、レイヤーの並べ替えが該当する。
- **2.5.8 Target Size (Minimum)**（2.2 で新設）：24×24 CSS px 以上（間隔による例外あり）。keymap-drawer のコンボ箱は既定で 28×26 px だが（[`CONFIGURATION.md` L27-33](https://github.com/caksoylar/keymap-drawer/blob/467abe2a2fee3a1ec1658d8c3fe33d1cc562b53c/CONFIGURATION.md#L27-L33)）、仕様書の例は 24×22 px に縮めている（[`KEYMAP_SPEC.md` L149-154](https://github.com/caksoylar/keymap-drawer/blob/467abe2a2fee3a1ec1658d8c3fe33d1cc562b53c/KEYMAP_SPEC.md#L149-L154)）。図を縮めて表示するときも、押せるコンボ箱は 24px を割らないようにする。
- **2.4.7 Focus Visible と 2.4.11 Focus Not Obscured**：固定のヘッダーや差分パネルがフォーカス中のキーを隠さないこと。Vercel の指針も同じことを書く（[README L8](https://github.com/vercel-labs/web-interface-guidelines/blob/434b7f91364665f2f733b310ec54809bf8f37937/README.md#L8)）。

**自動の点検**：axe-core（[dequelabs/axe-core](https://github.com/dequelabs/axe-core)）を Vitest か Playwright のテストに入れる。ただし、配列図のように独自の操作を持つ部品は、自動の点検では足りない。キーボードだけの通し操作と、VoiceOver での読み上げを手で確かめる。

### 4.4 実際に使って確かめる

所有者の手元に、実物とキーマップが揃っている。これを試験台にする。

1. **再現の試験**：`am338` の Keyball39 キーマップを読み込み、何も変えずに commit 確認画面を開く。差分が空になることを確かめる（往復で壊れないこと）。
2. **作業の試験**：次の作業を、時間と迷った箇所を記録しながら行う。
   - L0 の Q を Alt/Q から Cmd/Q に変える。
   - 右手のコンボ `M`＋`BTN1`→`,` を `.` に変える。
   - レイヤー 2 と 3 を入れ替え、`LT()` の番号が追従することを差分で確かめる。
   - Mac 表示で英数／かなキーの凡例を確かめる。
3. **ビルドと実機**：commit 後の GitHub Actions のビルドで hex を作り、Keyballer から書き込んで打鍵して確かめる。ZMK 機（roBa、meteorite40）でも同じ流れを通す（ZMK のビルドは README で「予定」）。
4. **他人に使ってもらう**：口を出さずに見る。疲れているとき、小さい画面、遅い回線でも触る（Kosta）。
5. **並べて見る**：VIA、ZMK Studio、Keyball Link と同じキーマップを表示した画面を並べ、Keyballer だと分かる点を言葉にする。言えなければ 1.4 に戻る。
6. **環境を変えて見る**：明暗のテーマ、`prefers-reduced-motion`、文字 200％、幅 320px、JIS と US のホスト、Mac と Windows。

---

## 出典一覧

調査日 2026-11-21。GitHub のリンクはすべて調査時点のコミットに固定した。

**AI スロップとデザインの指針**

- Anthropic, frontend-design スキル 2026-09 版 [`anthropics/skills@41bbe19d` skills/frontend-design/SKILL.md](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md)
- Anthropic, frontend-design スキル 2025-12 版 [`anthropics/skills@00756142`](https://github.com/anthropics/skills/blob/00756142ab04c82a447693cf373c4e0c554d1005/skills/frontend-design/SKILL.md)
- Anthropic, web-artifacts-builder スキル [`anthropics/skills@e4bb5d9` L20](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/web-artifacts-builder/SKILL.md#L20)
- Anthropic, frontend-design プラグイン [anthropics/claude-plugins-official plugins/frontend-design](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/frontend-design)（調査日に 2026-09 版と同一を確認）
- Anthropic, 「Improving frontend design through Skills」2025-11-12 <https://claude.com/blog/improving-frontend-design-through-skills>
- Anthropic, Cookbook「Frontend Aesthetics: A Prompting Guide」[`claude-cookbooks@8ad5de6` coding/prompting_for_frontend_aesthetics.ipynb](https://github.com/anthropics/claude-cookbooks/blob/8ad5de647d4f0f50c95d74aabc8aa20a3f70cdd3/coding/prompting_for_frontend_aesthetics.ipynb)
- OpenAI, GPT-5 prompting guide「Frontend app development」[`openai-cookbook@dfd760b`](https://github.com/openai/openai-cookbook/blob/dfd760b4de0bd175b51ad05b9b5260c36dfea09c/examples/gpt-5/gpt-5_prompting_guide.ipynb)
- OpenAI, Frontend with GPT-5 [`gpt-5_frontend.ipynb`](https://github.com/openai/openai-cookbook/blob/dfd760b4de0bd175b51ad05b9b5260c36dfea09c/examples/gpt-5/gpt-5_frontend.ipynb)
- OpenAI, Codex Prompting Guide「Frontend tasks」[`codex_prompting_guide.ipynb`](https://github.com/openai/openai-cookbook/blob/dfd760b4de0bd175b51ad05b9b5260c36dfea09c/examples/gpt-5/codex_prompting_guide.ipynb)
- OpenAI, GPT-5.2 prompting guide 3.2 [`gpt-5-2_prompting_guide.ipynb`](https://github.com/openai/openai-cookbook/blob/dfd760b4de0bd175b51ad05b9b5260c36dfea09c/examples/gpt-5/gpt-5-2_prompting_guide.ipynb)
- Paul Bakaus, impeccable「Craft floor」[`pbakaus/impeccable@b49177d` skill/reference/craft-floor.md](https://github.com/pbakaus/impeccable/blob/b49177d32788f2dc585c42831d845dacf1ebed2c/skill/reference/craft-floor.md)
- Kosta Canatselis, 「Spot the Slop: A UI Designer's Guide to Fixing AI Defaults」2026-07-23 <https://world.hey.com/kostac/spot-the-slop-a-ui-designer-s-guide-to-fixing-ai-defaults-4c448c9c>
- Frank Chimero, 「Beyond the Machine」2025 <https://frankchimero.com/blog/2025/beyond-the-machine/>
- Frank Chimero, 「The Web's Grain」2015 <https://frankchimero.com/blog/2015/the-webs-grain/>
- Goree, Doosti, Crandall, Su, 「Investigating the Homogenization of Web Design: A Mixed-Methods Approach」CHI '21, DOI 10.1145/3411764.3445156（本文未取得。弱い根拠）
- Vercel, Web Interface Guidelines [`vercel-labs/web-interface-guidelines@434b7f9` README.md](https://github.com/vercel-labs/web-interface-guidelines/blob/434b7f91364665f2f733b310ec54809bf8f37937/README.md)

**キーマップ編集ツール**

- QMK Configurator [`qmk/qmk_configurator@2dcdb25`](https://github.com/qmk/qmk_configurator/tree/2dcdb25feedd148be6c7f37593bd1c051262cdee)、Issues #943 #1007 #1154 #1372
- VIA [`the-via/app@75a7275`](https://github.com/the-via/app/tree/75a7275fd4e13b20f6d646583c5b6cbac8a9e92d)、Issues #106 #160 #238 #243 #248
- Vial [`vial-kb/vial-gui@aef8222`](https://github.com/vial-kb/vial-gui/tree/aef8222a2d0429a183b2ed692d5f9efcfd383f08)、Issues #232 #354 #373 #389
- ZMK Studio [`zmkfirmware/zmk-studio@1bb6bb8`](https://github.com/zmkfirmware/zmk-studio/tree/1bb6bb84a370c8917d8e4db15207087b26b3a844)、Issues #17 #93 #124 #147 #148 #151
- ZMK ドキュメント「ZMK Studio」[`zmk@4de3133` docs/docs/features/studio.md](https://github.com/zmkfirmware/zmk/blob/4de313367288aad5aeaa1243890e40dc813f7008/docs/docs/features/studio.md)
- nickcoutsos/keymap-editor [`@e794679`](https://github.com/nickcoutsos/keymap-editor/tree/e7946792cf674db20ab72ab67fea759fff4c3ccc)、Issues #131 #140 #224 #226 #328 #378
- Keyball Link [`Yowkees/keyball-link@6f6b1fb`](https://github.com/Yowkees/keyball-link/tree/6f6b1fbe70f91d682fefe0946309f4500d0c7637)、Issues #13 #20 #21、Discussions #5 #7 #11。本番 JS バンドルの写し（依頼者から提供、`app.js` 587,907 バイト）
- ZSA 公式ブログ：[Introducing Combos (2022-12-20)](https://blog.zsa.io/2212-combos/)、[Setting Up International Layouts (2023-03-07)](https://blog.zsa.io/international-setup/)、[Introducing Per-Key History (2023-06-22、2023-10 更新)](https://blog.zsa.io/history/)、[Tap and Hold Keys Explained (2024-04-01、2025-05 更新)](https://blog.zsa.io/tap-hold-explained/)、[Dual-function keys now make sense (2025-05-19)](https://blog.zsa.io/tap-hold-update/)、[Layer-Independent Combos (2026-11-09)](https://blog.zsa.io/layer-independent-combos/)、[Oryx Changes: I18n, Custom Labels… (2020-08-25)](https://blog.zsa.io/2008-oryx-changes/)
- Karabiner-Elements [`pqrs-org/Karabiner-Elements@e37fd62`](https://github.com/pqrs-org/Karabiner-Elements/tree/e37fd624d00e3f3bd7c84797f683fbf9a46ab7ef)（SimpleModificationPickerView.swift、simple_modifications.json、key_picker.json）、公式文書（[Simple Modifications](https://karabiner-elements.pqrs.org/docs/manual/configuration/configure-simple-modifications/)、[EventViewer](https://karabiner-elements.pqrs.org/docs/manual/operation/eventviewer/)、[Complex Modifications](https://karabiner-elements.pqrs.org/docs/manual/configuration/configure-complex-modifications/)、[non-ANSI keyboards](https://karabiner-elements.pqrs.org/docs/help/troubleshooting/symbols-with-non-ansi-keyboard/)）、Issue #4070

**配列・キーコードの仕様と慣習**

- keymap-drawer [`caksoylar/keymap-drawer@467abe2`](https://github.com/caksoylar/keymap-drawer/tree/467abe2a2fee3a1ec1658d8c3fe33d1cc562b53c)（KEYMAP_SPEC.md、CONFIGURATION.md、PHYSICAL_LAYOUTS.md、keymap_drawer/config.py、keymap_drawer/parse/parse.py）
- QMK docs [`qmk_firmware@80973aa`](https://github.com/qmk/qmk_firmware/tree/80973aa0b5413e9a5bbbf9293507f39e870f9aa3/docs)：reference_info_json.md、feature_layers.md、mod_tap.md、keycodes.md。quantum/keymap_extras/keymap_japanese.h
- ZMK [`zmk@4de3133`](https://github.com/zmkfirmware/zmk/tree/4de313367288aad5aeaa1243890e40dc813f7008)：docs/docs/hardware-integration/physical-layouts.md、app/include/dt-bindings/zmk/keys.h
- Keyball39 の配列定義 [`Yowkees/keyball@4664de9` keyball39/info.json, via.json](https://github.com/Yowkees/keyball/tree/4664de991d14da34bd42e7031ac7406b6ccb02af/qmk_firmware/keyboards/keyball/keyball39)
- 所有者のキーマップ：ローカルの `AkiraMisawa/keyball`、ブランチ `am338`、`683f8fc`、`qmk_firmware/keyboards/keyball/keyball39/keymaps/am338/keymap.c`
- Keyballer [`AkiraMisawa/keyballer@a963c8b`](https://github.com/AkiraMisawa/keyballer/tree/a963c8b5256cc8060ab7c7979215953a6dbc8059)：src/styles.css、README.md

**Web 標準とアクセシビリティ**

- W3C, UI Events KeyboardEvent code Values <https://www.w3.org/TR/uievents-code/>
- W3C, UI Events（§3.6.5 Key Events During Composition） <https://www.w3.org/TR/uievents/>
- W3C, WAI-ARIA Authoring Practices Guide：[Grid](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)、[Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)、[Combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)、[Listbox](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/)
- W3C, Web Content Accessibility Guidelines (WCAG) 2.2 <https://www.w3.org/TR/WCAG22/>
- Deque, axe-core <https://github.com/dequelabs/axe-core>
