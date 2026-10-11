// Size labels -> the body measurements they're cut for, and how that compares
// to the avatar. Brand charts differ; these are typical US/EU retail charts.
// When a store publishes its own chart we can swap it in per piece later.

const ALPHA = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];
const ALPHA_ALIASES = { '2XL': 'XXL', XXXL: '3XL', '2X': 'XXL', '3X': '3XL', '1X': 'XL', 'ONE SIZE': 'M', OS: 'M', 'O/S': 'M' };

// Body measurements (cm) each alpha size is made for.
const CHART = {
  male: {
    chest: [81, 86, 91, 99, 107, 115, 123, 131, 139],
    waist: [66, 71, 76, 84, 92, 100, 108, 116, 124],
    hip: [84, 89, 94, 100, 106, 112, 118, 124, 130],
  },
  female: {
    chest: [76, 81, 86, 91, 99, 107, 115, 123, 131],
    waist: [58, 63, 68, 73, 81, 89, 97, 105, 113],
    hip: [84, 89, 94, 99, 107, 115, 123, 131, 139],
  },
};

const TOPS = new Set(['tee', 'longsleeve', 'tank', 'sweater', 'hoodie', 'jacket', 'coat', 'dress']);
const BOTTOMS = new Set(['pants', 'shorts', 'skirt']);

/** Built-in ease (cm of circumference) each kind adds over the body at true size. */
export const KIND_EASE = {
  tee: 8, longsleeve: 8, tank: 4, sweater: 12, hoodie: 16, jacket: 16, coat: 20,
  pants: 4, shorts: 6, skirt: 6, dress: 6, shoes: 0, hat: 0,
};

const indexOf = (label) => {
  const u = String(label).toUpperCase().replace(/\s+/g, ' ').trim();
  const key = ALPHA_ALIASES[u] || u;
  const i = ALPHA.indexOf(key);
  return i >= 0 ? i : null;
};

/**
 * Parses a size label into what it means for this kind of garment:
 * { chest?, waist?, hip?, inseam? (cm), shoeUS?, step? } or null if unknown.
 */
export function parseSize(label, kind, sex) {
  if (!label) return null;
  const chart = CHART[sex === 'female' ? 'female' : 'male'];
  const raw = String(label).trim();
  const alpha = raw.match(/^(xxs|xs|s|m|l|xl|xxl|xxxl|[2-4]xl|[1-3]x|one size|os|o\/s)\b/i);
  if (alpha) {
    const i = indexOf(alpha[1]);
    if (i != null) return { chest: chart.chest[i], waist: chart.waist[i], hip: chart.hip[i], step: i };
  }

  // Waist x length (32x30, 32/30, W32 L30)
  const wl = raw.match(/^w?\s?(\d{2})\s*(?:[x\/]|\s+l)\s*l?(\d{2})$/i);
  if (wl && BOTTOMS.has(kind)) return { waist: Number(wl[1]) * 2.54, inseam: Number(wl[2]) * 2.54 };

  const num = Number(raw.replace(/^(us|eu|uk|it|fr)\s*/i, '').replace(',', '.'));
  if (!Number.isFinite(num)) return null;
  const region = (raw.match(/^(us|eu|uk|it|fr)/i)?.[1] || '').toLowerCase();

  if (kind === 'shoes') {
    const us = region === 'eu' || num > 30 ? num - (sex === 'female' ? 31 : 33) : region === 'uk' ? num + 1 : num;
    return { shoeUS: us };
  }
  if (BOTTOMS.has(kind) && num >= 23 && num <= 48) {
    // Waist in inches (men's and most denim).
    const waist = num * 2.54;
    return { waist, hip: waist + (sex === 'female' ? 26 : 16) };
  }
  if (sex === 'female' && num <= 24 && num % 2 === 0) {
    // US women's numeric (0, 2, 4 ... 20).
    const i = Math.min(ALPHA.length - 1, Math.max(0, Math.round(num / 4) + 1));
    return { chest: chart.chest[i] + ((num % 4) / 4) * 4, waist: chart.waist[i], hip: chart.hip[i] };
  }
  if (num >= 32 && num <= 60) {
    // EU numeric: men's tops (46-56) = chest/2, women's (32-48) = bust - 48ish.
    const chest = sex === 'female' ? num * 2 + 12 : num * 2;
    return { chest, waist: chest - (sex === 'female' ? 18 : 14), hip: chest + (sex === 'female' ? 6 : 2) };
  }
  return null;
}

/** US shoe size that fits a foot of this length (cm). */
export function shoeSizeFor(footCm, sex) {
  return sex === 'female' ? footCm * 1.18 - 18.3 : footCm * 1.18 - 20.7;
}

/**
 * How a size fits the avatar.
 * Returns { ease (cm, + = room), label, tone, lengthScale, inseam } where ease is
 * the room beyond the body in the size's key measurement.
 */
export function fitFor(piece, size, body, sex) {
  const kind = piece.kind;
  const parsed = parseSize(size, kind, sex);
  if (kind === 'shoes') {
    if (!parsed?.shoeUS) return { ease: 0, label: size ? 'Size not recognised' : 'Pick a size', tone: 'muted' };
    const diff = parsed.shoeUS - shoeSizeFor(body.footLength, sex);
    const label = diff < -0.75 ? 'Too small' : diff < -0.25 ? 'Snug' : diff <= 0.75 ? 'True to size' : diff <= 1.5 ? 'Roomy' : 'Too big';
    return { ease: diff, label, tone: Math.abs(diff) > 0.75 ? 'warn' : 'good' };
  }
  if (!parsed) return { ease: 0, label: size ? 'Size not recognised' : 'Pick a size', tone: 'muted', lengthScale: 1 };

  let diff;
  if (TOPS.has(kind)) diff = (parsed.chest ?? 0) - body.chest;
  else diff = Math.min((parsed.waist ?? 0) - body.waist, (parsed.hip ?? 99) - body.hip + 4);

  const label =
    diff < -8 ? 'Too tight' : diff < -3 ? 'Snug' : diff <= 4 ? 'True to size' : diff <= 10 ? 'Relaxed' : 'Oversized';
  const tone = diff < -8 ? 'warn' : diff < -3 ? 'ok' : diff <= 10 ? 'good' : 'ok';
  // Bigger alpha sizes are also longer; ~2 cm body length per size step.
  const userStep = nearestStep(body, kind, sex);
  const lengthScale = parsed.step != null && userStep != null ? 1 + (parsed.step - userStep) * 0.035 : 1;
  return { ease: diff, label, tone, lengthScale, inseam: parsed.inseam };
}

function nearestStep(body, kind, sex) {
  const chart = CHART[sex === 'female' ? 'female' : 'male'];
  const key = TOPS.has(kind) ? 'chest' : 'waist';
  let best = 0;
  for (let i = 0; i < ALPHA.length; i++) if (Math.abs(chart[key][i] - body[key]) < Math.abs(chart[key][best] - body[key])) best = i;
  return best;
}

/** The listed size that best fits the avatar (smallest one that isn't tight). */
export function recommendSize(piece, body, sex) {
  const scored = (piece.sizes || [])
    .map((s) => ({ s, f: fitFor(piece, s, body, sex) }))
    .filter((x) => x.f.label !== 'Size not recognised');
  if (!scored.length) return null;
  if (piece.kind === 'shoes') return scored.sort((a, b) => Math.abs(a.f.ease) - Math.abs(b.f.ease))[0].s;
  const ok = scored.filter((x) => x.f.ease >= -3).sort((a, b) => a.f.ease - b.f.ease);
  return (ok[0] || scored.sort((a, b) => b.f.ease - a.f.ease)[0]).s;
}
