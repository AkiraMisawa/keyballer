// The side panel while editing with no key selected: the shown layer (its
// name, the ball on it, adding and removing layers) and the combos. And the
// panel for making a combo or changing its output. See docs/plans/keymap-editor.md.

import { useEffect, useState } from 'react';
import { ballModeEditable, comboOutputProblem, comboProblem, type BallMode } from '../edit/session';
import type { EditSession } from '../edit/useEditSession';
import { useI18n } from '../i18n/react';
import { LAYER_FUNCTIONS } from './catalogue';
import { KeyPicker, type PickerContext } from './KeyPicker';
import { comboFiresOn, drawLayer, layerName, legendOf, parseKeycode, type ViewCombo, type ViewFile } from './view';

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

/**
 * A combo's keys as a layer has them: the base layer for QMK, whose combos name its keys. A
 * transparent key is named by what it does there, as the board shows it.
 */
function comboKeys(view: ViewFile, positions: (number | null)[], context: PickerContext, layer = 0): string[] {
  const keys = drawLayer(view, layer, context.display).keys;
  return positions.map((p) => {
    const k = p === null ? undefined : keys.find((key) => key.index === p);
    return k ? ((k.kind === 'transparent' ? k.fallsTo?.tap : undefined) ?? k.legend.tap) : '?';
  });
}

/** Where a combo's keys are read: the shown layer when the combo fires there, else the first it fires on. */
function keysLayer(view: ViewFile, combo: ViewCombo, shown: number): number {
  if (!view.zmk) return 0;
  if (comboFiresOn(view, combo, shown)) return shown;
  return combo.layers?.find((l) => l < view.layers.length) ?? 0;
}

/** The layers a ZMK combo fires on: every layer, or the ones chosen. */
function ComboLayers({ view, value, onChange }: { view: ViewFile; value: number[] | null; onChange: (layers: number[] | null) => void }) {
  const { t, lang } = useI18n();
  const toggle = (n: number) => {
    const next = value === null ? [n] : value.includes(n) ? value.filter((l) => l !== n) : [...value, n].sort((a, b) => a - b);
    // Taking away the last layer would widen the combo to every layer, which has its own button.
    if (next.length > 0) onChange(next);
  };
  return (
    <div className="stack">
      <span id="combo-layers">{t('edit.comboLayers')}</span>
      <div className="seg layers" role="group" aria-labelledby="combo-layers">
        <button type="button" aria-pressed={value === null} onClick={() => onChange(null)}>
          {t('edit.comboEveryLayer')}
        </button>
        {view.layers.map((_, n) => (
          <button key={n} type="button" aria-pressed={value?.includes(n) ?? false} onClick={() => toggle(n)}>
            {layerName(view, n, lang)}
          </button>
        ))}
      </div>
    </div>
  );
}

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
            <span>{comboKeys(view, c.positions, context, keysLayer(view, c, layer)).join(' + ')}</span>
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
            {view.zmk && c.layers?.length ? (
              <span className="muted combo-on">{t('edit.comboOnly', { layers: list(c.layers.map((n) => layerName(view, n, lang))) })}</span>
            ) : null}
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
  /** The layer shown on the board, where a ZMK combo's keys are picked. */
  layer: number;
  /** Making a combo: the keys picked on the board so far. Changing one: its name. */
  picked?: number[];
  change?: string;
  onDone: () => void;
}

/**
 * Making a combo (keys picked on the board, then its output) or changing a combo's output, and for
 * ZMK the layers it fires on.
 */
export function ComboPanel({ edit, context, layer, picked, change, onDone }: ComboProps) {
  const { view } = context;
  const { t, lang } = useI18n();
  // A new ZMK combo made on the base layer fires on every layer, as ZMK's are without `layers`;
  // one made on another layer, only there.
  const [layers, setLayers] = useState<number[] | null>(layer === 0 ? null : [layer]);
  if (!edit.session) return null;
  const existing = change ? view.combos.find((c) => c.name === change) : undefined;
  const positions = existing ? existing.positions.filter((p): p is number => p !== null) : (picked ?? []);
  const problem = existing ? undefined : comboProblem(edit.session, positions);
  const from = existing ? keysLayer(view, existing, layer) : view.zmk ? layer : 0;
  const keys = new Intl.ListFormat(lang, { type: 'conjunction' }).format(comboKeys(view, positions, context, from));
  return (
    <div className="stack">
      <h3>{existing ? t('edit.comboOutput', { keys }) : t('edit.addCombo')}</h3>
      {!existing && <p className="note">{t('edit.comboPick')}</p>}
      {!existing && positions.length > 0 && <p>{t('edit.comboKeys', { keys })}</p>}
      {problem && positions.length > 0 && <p className="note">{t(problem)}</p>}
      {view.zmk &&
        (existing && change ? (
          <ComboLayers view={view} value={existing.layers?.length ? existing.layers : null} onChange={(l) => edit.edit({ type: 'comboLayers', name: change, layers: l })} />
        ) : (
          <ComboLayers view={view} value={layers} onChange={setLayers} />
        ))}
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
            else edit.edit({ type: 'comboAdd', positions, output, ...(view.zmk ? { layers } : {}) });
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
