import { useState } from 'react';
import { parseIntelHex } from '../lib/ihex';

interface Props {
  disabled: boolean;
  onReady: (name: string, image: Uint8Array, split: boolean) => void;
}

export function LocalFirmware({ disabled, onReady }: Props) {
  const [error, setError] = useState('');
  const [split, setSplit] = useState(true);

  const onFile = async (file: File | undefined) => {
    setError('');
    if (!file) return;
    try {
      const { data } = parseIntelHex(await file.text());
      onReady(file.name, data, split);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <details className="panel local">
      <summary>手元の hex ファイルを書き込む</summary>
      <div className="stack">
        <p className="note">
          自分でビルドしたファームウェアを書き込めます。対応しているのは Pro Micro（ATmega32U4 / Caterina）用の .hex です。
        </p>
        <label className="check">
          <input id="local-split" type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />
          <span>左右分割のキーボード（左右それぞれに書き込む）</span>
        </label>
        <input
          id="local-file"
          type="file"
          accept=".hex"
          disabled={disabled}
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
