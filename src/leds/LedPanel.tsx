// The LED panel: whether this build's board has LEDs, the effect, colour and brightness at
// start-up, the effects the LED keys switch between, and what they cost in firmware size.
// Changes join the unsaved changes like the trackball's. See docs/plans/led-settings.md.

import { useEffect } from 'react';
import { SessionState } from '../edit/EditBar';
import { ledEffectsValue, ledModeValue, leds, savedLeds, type LedSetting } from '../edit/session';
import type { EditSession } from '../edit/useEditSession';
import type { MessageKey } from '../i18n/messages';
import { useI18n } from '../i18n/react';
import type { QmkBuild } from '../lib/manifest';
import { axesOf, EFFECTS, effectOf, estimateSize, variantOf, type AxisKind, type EffectId } from './leds';

interface Props {
  edit: EditSession;
  build: QmkBuild;
}

const AXIS_LABEL: Record<AxisKind, MessageKey> = {
  speed: 'led.speed',
  direction: 'led.direction',
  spread: 'led.spread',
  colours: 'led.colours',
};

/** The words for each value of an axis, low to high as rgblight.c counts them. */
function axisValues(kind: AxisKind, size: number): (MessageKey | string)[] {
  if (kind === 'direction') return ['led.forward', 'led.backward'];
  if (kind === 'colours') return ['led.ownColour', 'led.randomColours'];
  return Array.from({ length: size }, (_, i) => String(i + 1));
}

export function LedPanel({ edit, build }: Props) {
  const { t, lang } = useI18n();
  const number = (n: number) => n.toLocaleString(lang === 'ja' ? 'ja-JP' : 'en-US');

  // The panel is the first thing that needs the files.
  useEffect(() => edit.ensure());

  if (edit.state.status !== 'ready') return <SessionState edit={edit} />;

  const { session } = edit.state;
  const now = leds(session);
  const saved = savedLeds(session);
  const keymapC = session.base.files[`${session.base.keymapDir}/keymap.c`];
  const stamp = keymapC?.includes('KEYBALLER_LED_STAMP') ?? false;
  const set = (type: LedSetting, value: number) => edit.edit({ type, value });
  const disabled = edit.saving;
  const mode = now.mode;
  const effect = mode ? effectOf(mode.effect) : null;
  const values = mode ? axesOf(mode.effect, mode.variant) : [];
  const say = (word: MessageKey | string) => (word.includes('.') ? t(word as MessageKey) : word);

  // The latest build's size, with what LEDs cost then and now. Builds made before builds[].leds
  // say nothing about it; the files read decide then.
  const size =
    typeof build.size === 'number' && typeof build.max_size === 'number'
      ? estimateSize(
          build.size,
          { leds: typeof build.leds === 'boolean' ? build.leds : saved.fitted, effects: saved.effects, stamp },
          { leds: now.fitted, effects: now.effects, stamp },
        )
      : null;
  const max = typeof build.max_size === 'number' ? build.max_size : null;

  return (
    <div className="stack leds">
      <label className="check">
        <input type="checkbox" checked={now.fitted} disabled={disabled} onChange={(e) => set('leds', e.target.checked ? 1 : 0)} />
        {t('led.fitted', { name: build.name })}
      </label>
      <p className="note">{t(now.fitted ? 'led.fittedNote' : 'led.notFittedNote')}</p>

      {now.fitted && (
        <>
          <div className="field">
            <label htmlFor="led-effect">{t('led.effect')}</label>
            <select
              id="led-effect"
              value={mode?.effect ?? ''}
              disabled={disabled}
              onChange={(e) => set('ledMode', ledModeValue({ effect: e.target.value as EffectId, variant: 0 }))}
            >
              {!mode && <option value="">{t('led.unknownMode')}</option>}
              {EFFECTS.map((e) => (
                <option key={e.id} value={e.id}>
                  {t(e.label)}
                </option>
              ))}
            </select>
            {!mode && <p className="note">{t('led.unknownModeNote')}</p>}
          </div>

          {effect?.axes.map((axis, i) => (
            <div key={axis.kind} className="field">
              <span id={`led-axis-${axis.kind}`}>{t(AXIS_LABEL[axis.kind])}</span>
              <div className="seg layers" role="group" aria-labelledby={`led-axis-${axis.kind}`}>
                {axisValues(axis.kind, axis.size).map((word, value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={values[i] === value}
                    disabled={disabled}
                    onClick={() => {
                      const next = [...values];
                      next[i] = value;
                      set('ledMode', ledModeValue({ effect: effect.id, variant: variantOf(effect.id, next) }));
                    }}
                  >
                    {say(word)}
                  </button>
                ))}
              </div>
              {axis.kind === 'speed' && <p className="note">{t('led.speedNote')}</p>}
              {axis.kind === 'spread' && <p className="note">{t('led.spreadNote')}</p>}
            </div>
          ))}

          <div className="field">
            <label htmlFor="led-hue">{t('led.hue')}</label>
            <div className="range">
              <span
                className="swatch"
                aria-hidden="true"
                style={{ background: `hsl(${Math.round((now.hue / 256) * 360)} ${Math.round((now.sat / 255) * 100)}% 50%)` }}
              />
              <input
                id="led-hue"
                type="range"
                min={0}
                max={255}
                value={now.hue}
                disabled={disabled}
                onChange={(e) => set('ledHue', Number(e.target.value))}
              />
              <span className="note">{now.hue}</span>
            </div>
          </div>
          <div className="field">
            <label htmlFor="led-sat">{t('led.sat')}</label>
            <div className="range">
              <input id="led-sat" type="range" min={0} max={255} value={now.sat} disabled={disabled} onChange={(e) => set('ledSat', Number(e.target.value))} />
              <span className="note">{now.sat}</span>
            </div>
          </div>
          <div className="field">
            <label htmlFor="led-val">{t('led.val')}</label>
            <div className="range">
              <input id="led-val" type="range" min={0} max={now.limit} value={Math.min(now.val, now.limit)} disabled={disabled} onChange={(e) => set('ledVal', Number(e.target.value))} />
              <span className="note">{now.val}</span>
            </div>
            {now.limit < 255 && <p className="note">{t('led.limitNote', { limit: now.limit })}</p>}
          </div>

          <label className="check">
            <input type="checkbox" checked={now.startOn} disabled={disabled} onChange={(e) => set('ledStartOn', e.target.checked ? 1 : 0)} />
            {t('led.startOn')}
          </label>

          <fieldset className="stack">
            <legend>{t('led.included')}</legend>
            {EFFECTS.filter((e) => e.define).map((e) => {
              const atStart = mode?.effect === e.id;
              const on = now.effects.includes(e.id);
              return (
                <label key={e.id} className="check">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={disabled || atStart}
                    onChange={(ev) =>
                      set('ledEffects', ledEffectsValue(ev.target.checked ? [...now.effects, e.id] : now.effects.filter((id) => id !== e.id)))
                    }
                  />
                  {t(e.label)}
                  <span className="muted">{atStart ? t('led.atStart') : t('led.cost', { n: number(e.own) })}</span>
                </label>
              );
            })}
            <p className="note">{t('led.includedNote')}</p>
          </fieldset>
        </>
      )}

      {size !== null && max !== null && (
        <div className="stack">
          <p className={size > max ? 'notice' : undefined}>
            {size > max
              ? t('led.sizeOver', { size: number(size), max: number(max), over: number(size - max) })
              : t('led.size', { size: number(size), max: number(max), left: number(max - size) })}
          </p>
          <p className="note">{t('led.sizeNote')}</p>
        </div>
      )}

      {now.fitted && <p className="note">{t('led.shared')}</p>}
      {now.fitted && !stamp && <p className="note">{t('led.noStamp')}</p>}
    </div>
  );
}
