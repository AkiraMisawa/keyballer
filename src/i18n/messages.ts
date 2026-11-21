// Every user-facing string, in Japanese and English. `{name}` is a
// placeholder filled from params. Adding a key to `ja` without adding it to
// `en` fails the type check.

export const ja = {
  'app.tagline': 'GitHub でビルドしたキーボードのファームウェアを、ブラウザから書き込みます。',
  'app.noSerial':
    'このブラウザは USB での書き込みに対応していません。パソコンの Chrome か Edge で開いてください。',
  'app.footer':
    '書き込みには Chrome / Edge の Web Serial を使います。ファームウェアはこのページから直接キーボードに送られ、外部には送信されません。',
  'app.language': '言語',

  'common.close': '閉じる',
  'common.cancel': 'やめる',
  'common.unknown': '不明',

  'repo.title': '設定リポジトリ',
  'repo.placeholder': 'owner/repo（例：AkiraMisawa/keyballer-config）',
  'repo.connect': '接続',
  'repo.connecting': '接続中…',
  'repo.invalid': '「owner/repo」の形で入力してください（例：AkiraMisawa/keyballer-config）',
  'token.summary': '非公開リポジトリを使う（トークン）',
  'token.note':
    '対象のリポジトリだけを選び、Contents と Actions を「読み取り」にした fine-grained token を貼り付けてください。このブラウザの中にだけ保存されます。',

  'status.title': 'ビルド',
  'status.refresh': '最新の状態にする',
  'status.refreshing': '確認中…',
  'status.current': 'いまのファームウェアは {commit} の設定から {date} にビルドしたものです。',
  'status.none':
    'まだファームウェアがありません。設定リポジトリに push すると、GitHub Actions がビルドします。',
  'status.latest': '最新のビルド：{title}（{commit}、{date}）',
  'status.building': '新しい設定をビルドしています。終わると自動でここに反映されます。',
  'status.failedNewer':
    '新しい設定のビルドが失敗したため、下のファームウェアは1つ前のものです。リンク先でエラーを確認してください。',
  'run.busy': 'ビルド中',
  'run.ok': '成功',
  'run.cancelled': '中止',
  'run.failed': '失敗',

  'firmware.title': 'ファームウェア',
  'card.specs': '仕様',
  'card.split': '左右分割',
  'card.size': '{size} / {max} バイト（残り {free}）',
  'card.flash': '書き込む',
  'card.loading': '読み込み中…',
  'card.unsupported': 'この書き込み方式（{bootloader} / {format}）にはまだ対応していません',

  'local.summary': '手元の hex ファイルを書き込む',
  'local.note':
    '自分でビルドしたファームウェアを書き込めます。対応しているのは Pro Micro（ATmega32U4 / Caterina）用の .hex です。',
  'local.split': '左右分割のキーボード（左右それぞれに書き込む）',

  'flash.title': '{name} に書き込む',
  'flash.halves': '左右の書き込み状況',
  'flash.first': '1台目',
  'flash.second': '2台目',
  'flash.plug': 'USB ケーブルをキーボードにつなぎます。',
  'flash.plugSplit': 'USB ケーブルを左右どちらか片方のキーボードにつなぎます。',
  'flash.trsNote':
    '左右をつなぐケーブル（TRS / TRRS）はつないだままで大丈夫です。抜き差しするときは必ず先に USB を抜いてください。',
  'flash.pressReset': '「書き込みを始める」を押してから、キーボードのリセットボタンを押します。',
  'flash.eeprom': '保存されている設定（EEPROM）も消す',
  'flash.eepromNote':
    'Keyball Link や REMAP など、別のファームウェアから書き換えるときはオンにしてください。',
  'flash.start': '書き込みを始める',
  'flash.waiting': 'リセットボタンを押してください。反応しないときは素早く2回押します。',
  'flash.waitingNote':
    '押してから約8秒のあいだ、書き込みを受け付けます。押したら下のボタンでポートを選んでください。2回目以降は自動で始まることがあります。',
  'flash.pickPort': 'ポートを選ぶ',
  'flash.pickAny': '一覧に出てこないとき（すべてのデバイスから選ぶ）',
  'flash.progress': '{phase}…（{percent}%）',
  'flash.finished': '書き込みが終わりました',
  'flash.dontUnplug': '書き込みが終わるまで USB ケーブルを抜かないでください。',
  'flash.otherHalf':
    '反対側も書き込みます。USB ケーブルを抜いて反対側につなぎ替えてください。左右とも同じファームウェアを書き込みます。',
  'flash.flashOther': '反対側を書き込む',
  'flash.doneSplit': '左右とも書き込みました。キーボードはそのまま使えます。',
  'flash.doneSingle': '書き込みました。キーボードはそのまま使えます。',
  'flash.failed': '書き込めませんでした：{error}',
  'flash.failedNote':
    'キーボードのリセットボタンを押し直してから、もう一度試してください。ほかのアプリ（QMK Toolbox など）がポートを使っていると書き込めません。',
  'flash.retry': 'もう一度試す',
  'flash.log': '詳しいログ',

  'phase.preparing': '準備中',
  'phase.connect': 'ブートローダーに接続',
  'phase.erase': 'フラッシュを消去',
  'phase.eeprom': 'EEPROM を消去',
  'phase.write': '書き込み',
  'phase.verify': '書き込んだ内容を確認',
  'phase.finish': '再起動',

  'step.identify': 'ブートローダーの確認',
  'step.signature': 'マイコンの確認',
  'step.progMode': '書き込みモードへの切り替え',
  'step.erase': 'フラッシュの消去',
  'step.eeprom': 'EEPROM の消去',
  'step.address': 'アドレス設定',
  'step.write': '書き込み（{addr}）',
  'step.read': '読み出し（{addr}）',
  'step.leave': '書き込みモードの終了',
  'step.exit': 'ブートローダーの終了',

  'flash.err.disconnected': '{step}：接続が切れました',
  'flash.err.noResponse': '{step}：応答がありません',
  'flash.err.unexpected': '{step}：想定外の応答 {byte} です',
  'flash.err.tooLarge': 'ファームウェアが大きすぎます（{size} バイト、上限 {max} バイト）',
  'flash.err.openFailed': 'シリアルポートを開けませんでした',
  'flash.err.wrongMcu': 'ATmega32U4 ではないマイコンです（signature {sig}）。書き込みを中止しました',
  'flash.err.mismatch': '{addr} の内容が一致しません（期待 {expected}、実際 {actual}）',

  'flash.log.found': 'ブートローダーが見つかりました',
  'flash.log.stale': '接続前に届いていた {count} バイトを読み捨てました',
  'flash.log.bootloader': 'ブートローダー：{id}',
  'flash.log.mcu': 'マイコン：ATmega32U4（{sig}）',
  'flash.log.erased': 'フラッシュを消去しました',
  'flash.log.eepromErased': 'EEPROM を消去しました',
  'flash.log.written': '{pages} ページ（{bytes} バイト）を書き込みました',
  'flash.log.drained': '想定外の応答 {count} バイトを読み捨てました',
  'flash.log.rewrite': '{addr} が一致しません（期待 {expected}、実際 {actual}）。書き直します',
  'flash.log.verified': '書き込んだ内容を確認しました',
  'flash.log.restarted': 'キーボードを再起動しました',

  'hex.err.afterEof': '{line} 行目：終端のあとにデータがあります',
  'hex.err.format': '{line} 行目：Intel HEX の形式ではありません',
  'hex.err.notHex': '{line} 行目：16 進数でない文字があります',
  'hex.err.length': '{line} 行目：長さが合いません',
  'hex.err.checksum': '{line} 行目：チェックサムが合いません',
  'hex.err.recordType': '{line} 行目：未対応のレコード種別 {type} です',
  'hex.err.noEof': 'ファイルが途中で切れています（終端レコードがありません）',
  'hex.err.empty': '書き込むデータがありません',

  'gh.err.badToken': 'トークンが無効です',
  'gh.err.rateLimit':
    'GitHub API の利用回数の上限に達しました。しばらく待つか、トークンを設定してください',
  'gh.err.notFound': '見つかりません',
  'gh.err.status': 'GitHub API がエラーを返しました（{status}）',
  'gh.err.repoNotFound': '{repo} が見つかりません。非公開リポジトリならトークンを設定してください',
  'manifest.err.format': 'manifest.json の形式が想定と違います',
} as const;

export type MessageKey = keyof typeof ja;

export const en: Record<MessageKey, string> = {
  'app.tagline': 'Flash keyboard firmware built on GitHub, right from your browser.',
  'app.noSerial':
    'This browser cannot flash over USB. Open this page in Chrome or Edge on a computer.',
  'app.footer':
    'Flashing uses Web Serial in Chrome / Edge. The firmware goes straight from this page to your keyboard and is not sent anywhere else.',
  'app.language': 'Language',

  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.unknown': 'Unknown',

  'repo.title': 'Config repository',
  'repo.placeholder': 'owner/repo (e.g. AkiraMisawa/keyballer-config)',
  'repo.connect': 'Connect',
  'repo.connecting': 'Connecting…',
  'repo.invalid': 'Enter it as "owner/repo" (e.g. AkiraMisawa/keyballer-config)',
  'token.summary': 'Use a private repository (token)',
  'token.note':
    'Paste a fine-grained token limited to this repository, with read access to Contents and Actions. It is stored only in this browser.',

  'status.title': 'Build',
  'status.refresh': 'Refresh',
  'status.refreshing': 'Checking…',
  'status.current': 'The current firmware was built from {commit} on {date}.',
  'status.none':
    'There is no firmware yet. Push to the config repository and GitHub Actions will build it.',
  'status.latest': 'Latest build: {title} ({commit}, {date})',
  'status.building': 'Building your new settings. The result shows up here when it finishes.',
  'status.failedNewer':
    'The build of your new settings failed, so the firmware below is the previous one. Open the link to see the error.',
  'run.busy': 'Building',
  'run.ok': 'Succeeded',
  'run.cancelled': 'Cancelled',
  'run.failed': 'Failed',

  'firmware.title': 'Firmware',
  'card.specs': 'Specs',
  'card.split': 'Split',
  'card.size': '{size} / {max} bytes ({free} free)',
  'card.flash': 'Flash',
  'card.loading': 'Loading…',
  'card.unsupported': 'Flashing this way ({bootloader} / {format}) is not supported yet',

  'local.summary': 'Flash a hex file from your computer',
  'local.note':
    'Flash firmware you built yourself. Supported: .hex files for Pro Micro (ATmega32U4 / Caterina).',
  'local.split': 'Split keyboard (flash each half)',

  'flash.title': 'Flash {name}',
  'flash.halves': 'Progress on each half',
  'flash.first': 'First half',
  'flash.second': 'Second half',
  'flash.plug': 'Connect the USB cable to the keyboard.',
  'flash.plugSplit': 'Connect the USB cable to either half of the keyboard.',
  'flash.trsNote':
    'You can leave the cable between the halves (TRS / TRRS) connected. Always unplug USB before plugging or unplugging it.',
  'flash.pressReset': 'Press "Start flashing", then press the reset button on the keyboard.',
  'flash.eeprom': 'Also clear saved settings (EEPROM)',
  'flash.eepromNote':
    'Turn this on when replacing different firmware, such as Keyball Link or REMAP.',
  'flash.start': 'Start flashing',
  'flash.waiting': 'Press the reset button. If nothing happens, press it twice quickly.',
  'flash.waitingNote':
    'The keyboard accepts new firmware for about 8 seconds after the reset. Choose its port with the button below. From the second time on, flashing may start by itself.',
  'flash.pickPort': 'Choose port',
  'flash.pickAny': 'Not in the list? Choose from all devices',
  'flash.progress': '{phase}… ({percent}%)',
  'flash.finished': 'Flashing finished',
  'flash.dontUnplug': 'Keep the USB cable connected until flashing finishes.',
  'flash.otherHalf':
    'Now flash the other half. Unplug the USB cable and connect it to the other half. Both halves get the same firmware.',
  'flash.flashOther': 'Flash the other half',
  'flash.doneSplit': 'Both halves are flashed. The keyboard is ready to use.',
  'flash.doneSingle': 'Flashed. The keyboard is ready to use.',
  'flash.failed': 'Flashing failed: {error}',
  'flash.failedNote':
    'Press the reset button on the keyboard again and retry. Flashing fails while another app (such as QMK Toolbox) is using the port.',
  'flash.retry': 'Try again',
  'flash.log': 'Detailed log',

  'phase.preparing': 'Preparing',
  'phase.connect': 'Connecting to the bootloader',
  'phase.erase': 'Erasing flash',
  'phase.eeprom': 'Clearing EEPROM',
  'phase.write': 'Writing',
  'phase.verify': 'Verifying',
  'phase.finish': 'Restarting',

  'step.identify': 'Identifying the bootloader',
  'step.signature': 'Reading the MCU signature',
  'step.progMode': 'Entering programming mode',
  'step.erase': 'Erasing flash',
  'step.eeprom': 'Clearing EEPROM',
  'step.address': 'Setting the address',
  'step.write': 'Writing {addr}',
  'step.read': 'Reading {addr}',
  'step.leave': 'Leaving programming mode',
  'step.exit': 'Leaving the bootloader',

  'flash.err.disconnected': '{step}: the connection was lost',
  'flash.err.noResponse': '{step}: no response',
  'flash.err.unexpected': '{step}: unexpected response {byte}',
  'flash.err.tooLarge': 'The firmware is too large ({size} bytes; the limit is {max} bytes)',
  'flash.err.openFailed': 'Could not open the serial port',
  'flash.err.wrongMcu': 'This MCU is not an ATmega32U4 (signature {sig}). Flashing was stopped',
  'flash.err.mismatch': 'Data at {addr} does not match (expected {expected}, got {actual})',

  'flash.log.found': 'Found the bootloader',
  'flash.log.stale': 'Discarded {count} bytes received before connecting',
  'flash.log.bootloader': 'Bootloader: {id}',
  'flash.log.mcu': 'MCU: ATmega32U4 ({sig})',
  'flash.log.erased': 'Erased the flash',
  'flash.log.eepromErased': 'Cleared the EEPROM',
  'flash.log.written': 'Wrote {pages} pages ({bytes} bytes)',
  'flash.log.drained': 'Discarded {count} unexpected bytes',
  'flash.log.rewrite': '{addr} does not match (expected {expected}, got {actual}). Rewriting it',
  'flash.log.verified': 'Verified the written data',
  'flash.log.restarted': 'Restarted the keyboard',

  'hex.err.afterEof': 'Line {line}: data after the end record',
  'hex.err.format': 'Line {line}: not in Intel HEX format',
  'hex.err.notHex': 'Line {line}: contains a character that is not hexadecimal',
  'hex.err.length': 'Line {line}: the length does not match',
  'hex.err.checksum': 'Line {line}: the checksum does not match',
  'hex.err.recordType': 'Line {line}: record type {type} is not supported',
  'hex.err.noEof': 'The file is cut off (it has no end record)',
  'hex.err.empty': 'There is no data to write',

  'gh.err.badToken': 'The token is not valid',
  'gh.err.rateLimit': 'You have reached the GitHub API rate limit. Wait a while or set a token',
  'gh.err.notFound': 'Not found',
  'gh.err.status': 'GitHub API returned an error ({status})',
  'gh.err.repoNotFound': '{repo} was not found. If it is private, set a token',
  'manifest.err.format': 'manifest.json is not in the expected format',
};
