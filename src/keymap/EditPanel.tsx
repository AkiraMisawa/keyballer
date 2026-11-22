// The side panel while editing with no key selected: the shown layer (its
// name, the ball on it, adding and removing layers) and the combos. And the
// panel for making a combo or changing its output. See docs/plans/keymap-editor.md.

import { useEffect, useState } from 'react';
import { ballModeEditable, comboOutputProblem, comboProblem, type BallMode } from '../edit/session';
import type { EditSession } from '../edit/useEditSession';
import { useI18n } from '../i18n/react';
import { LAYER_FUNCTIONS } from './catalogue';
import { KeyPicker, type PickerContext } from './KeyPicker';
import { layerName, legendOf, parseKeycode, type ViewFile } from './view';

/** What still leads to a layer: keys on other layers, and combos whose output is a layer key. */
export function leadingTo(context: PickerContext, target: number): string[] {
  const { view, display } = context;
  const leads = (k: string) => {
    const { name, args } = parseKeycode(k);
    return LAYER_FUNCTIONS.concat('LT').includes(name) && Number(args[0]?.name) === target;
  };
  const keys = view.layers.flatMap((l, n) => (n === target ? [] : l.keys.filter(leads).map((k) => legendOf(view, k, display).tap)));
  const combos = view.combos.filter((c) => leads(c.output)).map((c) => legendOf(view, c.output, display).tap);
  return [...keys, ...combos];
}

const comboKeys = (view: ViewFile, positions: (number | null)[], context: PickerContext) =>
  positions.map((p) => (p === null ? '?' : legendOf(view, view.layers[0].keys[p], context.display).tap));

interface Props {
  edit: EditSession;
  context: PickerContext;
  layer: number;
  sharedBy: string[];
  onAddCombo: () => void;
  onChangeCombo: (name: string) => void;
  onRemoveLayer: () => void;
}

export function EditPanel({ edit, context, layer, sharedBy, onAddCombo, onChangeCombo, onRemoveLayer }: Props) {
  const { view, display } = context;
  const { t, lang } = useI18n();
  const [name, setName] = useState(view.layers[layer]?.name ?? '');
  useEffect(() => setName(view.layers[layer]?.name ?? ''), [view, layer]);
  if (!edit.session) return <p className="note">{t('edit.notLoaded')}</p>;

  const shown = layerName(view, layer, lang);
  const last = view.layers.length - 1;
  const ballEditable = ballModeEditable(edit.session);
  const mode = (view.layers[layer]?.ball ?? 'cursor') as BallMode;
  const list = (items: string[]) => new Intl.ListFormat(lang, { type: 'conjunction' }).format(items);
  const rename = () => {
    const next = name.trim();
    if (next && next !== view.layers[layer]?.name) edit.edit({ type: 'layerName', layer, name: next });
  };

  return (
    <div className="stack edit-panel">
      <p className="note">{t('edit.chooseKey')}</p>
      {!edit.dirty && <p className="note">{t('edit.noChanges')}</p>}
      {sharedBy.length > 1 && <p className="note">{t('edit.sharedKeymap', { names: list(sharedBy) })}</p>}

      <h3>{t('keymap.layers')}</h3>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          rename();
        }}
      >
        <label htmlFor="layer-name">{t('edit.layerName', { layer: shown })}</label>
        <input id="layer-name" type="text" value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} />
      </form>
      {view.balls.length > 0 && (
        <div className="stack">
          <span>{t('edit.ballMode', { layer: shown })}</span>
          {ballEditable ? (
            <div className="seg" role="group" aria-label={t('edit.ballMode', { layer: shown })}>
              {(['cursor', 'scroll'] as const).map((m) => (
                <button key={m} type="button" aria-pressed={mode === m} onClick={() => edit.edit({ type: 'ballMode', layer, mode: m })}>
                  {t(m === 'cursor' ? 'legend.cursor' : 'legend.scroll')}
                </button>
              ))}
            </div>
          ) : (
            <p className="note">{t('edit.ballInCode')}</p>
          )}
        </div>
      )}
      <div className="row">
        <button type="button" onClick={() => edit.edit({ type: 'layerAdd' })}>
          {t('edit.addLayer')}
        </button>
        {last > 0 && (
          <button type="button" onClick={onRemoveLayer}>
            {t('edit.removeLayer', { n: last })}
          </button>
        )}
      </div>

      <h3>{t('keymap.combos')}</h3>
      <ul className="combo-list">
        {view.combos.map((c, i) => (
          <li key={c.name ?? i}>
            <span>{comboKeys(view, c.positions, context).join(' + ')}</span>
            <span className="out">
              <span className="muted">=</span>
              <span>{legendOf(view, c.output, display).tap}</span>
              {c.name && (
                <>
                  <button type="button" className="link" onClick={() => onChangeCombo(c.name!)}>
                    {t('edit.changeCombo')}
                  </button>
                  <button type="button" className="link" onClick={() => edit.edit({ type: 'comboRemove', name: c.name! })}>
                    {t('edit.removeCombo')}
                  </button>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onAddCombo}>
        {t('edit.addCombo')}
      </button>
    </div>
  );
}

interface ComboProps {
  edit: EditSession;
  context: PickerContext;
  /** Making a combo: the keys picked on the board so far. Changing one: its name. */
  picked?: number[];
  change?: string;
  onDone: () => void;
}

/** Making a combo (keys picked on the board, then its output) or changing a combo's output. */
export function ComboPanel({ edit, context, picked, change, onDone }: ComboProps) {
  const { view } = context;
  const { t, lang } = useI18n();
  if (!edit.session) return null;
  const existing = change ? view.combos.find((c) => c.name === change) : undefined;
  const positions = existing ? existing.positions.filter((p): p is number => p !== null) : (picked ?? []);
  const problem = existing ? undefined : comboProblem(edit.session, positions);
  const keys = new Intl.ListFormat(lang, { type: 'conjunction' }).format(comboKeys(view, positions, context));
  return (
    <div className="stack">
      <h3>{existing ? t('edit.comboOutput', { keys }) : t('edit.addCombo')}</h3>
      {!existing && <p className="note">{t('edit.comboPick')}</p>}
      {!existing && positions.length > 0 && <p>{t('edit.comboKeys', { keys })}</p>}
      {problem && positions.length > 0 && <p className="note">{t(problem)}</p>}
      {!problem && (
        <KeyPicker
          context={context}
          keyId={existing ? `combo:${change}` : `combo:new:${positions.join()}`}
          keycode={existing?.output ?? 'KC_NO'}
          tapOnly
          problem={(output) => (edit.session ? comboOutputProblem(edit.session, output) : undefined)}
          listenRequest={0}
          focusRequest={0}
          focusOnMount
          onAssign={(output) => {
            if (existing && change) edit.edit({ type: 'comboSet', name: change, positions, output });
            else edit.edit({ type: 'comboAdd', positions, output });
            onDone();
          }}
        />
      )}
      <button type="button" className="ghost" onClick={onDone}>
        {t('edit.cancel')}
      </button>
    </div>
  );
}
