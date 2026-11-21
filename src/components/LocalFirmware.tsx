import { useRef, useState } from 'react';
import { useCommand } from '../commands/react';
import { msg } from '../i18n/core';
import { useI18n } from '../i18n/react';
import { parseIntelHex } from '../lib/ihex';

interface Props {
  disabled: boolean;
  onReady: (name: string, image: Uint8Array, split: boolean) => void;
}

export function LocalFirmware({ disabled, onReady }: Props) {
  const { t, err } = useI18n();
  const [error, setError] = useState<unknown>(null);
  const [split, setSplit] = useState(true);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useCommand({
    id: 'flash.file',
    words: 'flash file',
    title: msg('shortcut.openHex'),
    group: 'group.firmware',
    shortcut: 'o',
    unavailable: disabled ? msg('why.flashing') : undefined,
    run: () => {
      if (detailsRef.current) detailsRef.current.open = true;
      fileRef.current?.click();
    },
  });

  const onFile = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    try {
      const { data } = parseIntelHex(await file.text());
      onReady(file.name, data, split);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <details ref={detailsRef} className="panel local">
      <summary>{t('local.summary')}</summary>
      <div className="stack">
        <p className="note">{t('local.note')}</p>
        <label className="check">
          <input id="local-split" type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />
          <span>{t('local.split')}</span>
        </label>
        <input
          ref={fileRef}
          id="local-file"
          type="file"
          accept=".hex"
          disabled={disabled}
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        {error !== null && (
          <p className="err" role="alert">
            {err(error)}
          </p>
        )}
      </div>
    </details>
  );
}
