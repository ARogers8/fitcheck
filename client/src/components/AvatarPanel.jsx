import { SKIN_TONES, HAIR_STYLES, HAIR_COLORS, cmToFtIn, ftInToCm, kgToLb, lbToKg } from '../body/measurements.js';

export default function AvatarPanel({ avatar, onChange }) {
  const imperial = avatar.units === 'imperial';
  const { ft, in: inch } = cmToFtIn(avatar.heightCm);
  return (
    <section className="panel avatar-panel">
      <h2>Your model</h2>

      <div className="field">
        <span className="label">Body</span>
        <div className="seg">
          {['male', 'female'].map((s) => (
            <button key={s} className={avatar.sex === s ? 'on' : ''} onClick={() => onChange({ sex: s, hairStyle: s === 'female' ? 'long' : 'short' })}>
              {s === 'male' ? 'Male' : 'Female'}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="label">Skin tone</span>
        <div className="swatches">
          {SKIN_TONES.map((t) => (
            <button
              key={t.id}
              title={t.label}
              aria-label={t.label}
              className={`swatch ${avatar.skin === t.id ? 'on' : ''}`}
              style={{ background: t.color }}
              onClick={() => onChange({ skin: t.id })}
            />
          ))}
        </div>
      </div>

      <div className="field">
        <span className="label">Hair</span>
        <div className="seg small">
          {HAIR_STYLES.map((h) => (
            <button key={h} className={avatar.hairStyle === h ? 'on' : ''} onClick={() => onChange({ hairStyle: h })}>
              {h[0].toUpperCase() + h.slice(1)}
            </button>
          ))}
        </div>
        <div className="swatches">
          {HAIR_COLORS.map((c) => (
            <button key={c} aria-label={`Hair colour ${c}`} className={`swatch small ${avatar.hairColor === c ? 'on' : ''}`} style={{ background: c }} onClick={() => onChange({ hairColor: c })} />
          ))}
        </div>
      </div>

      <div className="field">
        <div className="label-row">
          <span className="label">Height</span>
          <strong>{imperial ? `${ft}′ ${inch}″` : `${Math.round(avatar.heightCm)} cm`}</strong>
        </div>
        <input type="range" min={140} max={210} step={imperial ? 2.54 : 1} value={avatar.heightCm} onChange={(e) => onChange({ heightCm: Number(e.target.value) })} />
        {imperial && (
          <div className="inline-inputs">
            <input type="number" min={4} max={7} value={ft} onChange={(e) => onChange({ heightCm: ftInToCm(e.target.value, inch) })} aria-label="Feet" /> ft
            <input type="number" min={0} max={11} value={inch} onChange={(e) => onChange({ heightCm: ftInToCm(ft, e.target.value) })} aria-label="Inches" /> in
          </div>
        )}
      </div>

      <div className="field">
        <div className="label-row">
          <span className="label">Weight</span>
          <strong>{imperial ? `${Math.round(kgToLb(avatar.weightKg))} lb` : `${Math.round(avatar.weightKg)} kg`}</strong>
        </div>
        <input type="range" min={40} max={160} step={0.5} value={avatar.weightKg} onChange={(e) => onChange({ weightKg: Number(e.target.value) })} />
        <div className="inline-inputs">
          <input
            type="number"
            value={imperial ? Math.round(kgToLb(avatar.weightKg)) : Math.round(avatar.weightKg)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v > 0) onChange({ weightKg: Math.min(160, Math.max(40, imperial ? lbToKg(v) : v)) });
            }}
            aria-label="Weight"
          />{' '}
          {imperial ? 'lb' : 'kg'}
        </div>
      </div>

      <div className="field">
        <span className="label">Units</span>
        <div className="seg small">
          <button className={imperial ? 'on' : ''} onClick={() => onChange({ units: 'imperial' })}>ft / lb</button>
          <button className={!imperial ? 'on' : ''} onClick={() => onChange({ units: 'metric' })}>cm / kg</button>
        </div>
      </div>
      <p className="hint">More build options (shoulders, chest, hips, inseam) are coming next.</p>
    </section>
  );
}
