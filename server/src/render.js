// Photoreal try-on through FASHN (https://fashn.ai). Claude can read photos but not
// paint them, so the realistic picture comes from an image-generation try-on model:
// first a studio photo of a person matching the avatar ("model-create"), then each
// piece is put on in turn ("tryon-v1.6"), bottoms before tops so layers stack.
import { createHash } from 'node:crypto';

const API = 'https://api.fashn.ai/v1';

export const renderAvailable = () => Boolean(process.env.FASHN_API_KEY);

export class RenderError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const SKIN_WORDS = {
  porcelain: 'very fair porcelain', light: 'fair', 'light-medium': 'light medium', olive: 'olive',
  medium: 'medium', tan: 'tan', brown: 'brown', deep: 'deep brown', rich: 'very dark brown',
};
const HAIR_WORDS = { short: 'short', buzz: 'buzz-cut', long: 'long', bun: 'tied back in a bun' };
const HAIR_COLOR_WORDS = {
  '#1b1512': 'black', '#3b2618': 'dark brown', '#6b4428': 'brown', '#a87945': 'light brown',
  '#d8b67c': 'blonde', '#8c8c8c': 'grey', '#b5432c': 'red',
};

/** Words for the build, from BMI. */
function buildWord(heightCm, weightKg) {
  const bmi = weightKg / (heightCm / 100) ** 2;
  if (bmi < 18.5) return 'slim';
  if (bmi < 23) return 'lean, athletic';
  if (bmi < 26.5) return 'average';
  if (bmi < 30) return 'stocky, broad';
  return 'heavyset, plus-size';
}

export function modelPrompt(avatar = {}) {
  const female = avatar.sex === 'female';
  const cm = Number(avatar.heightCm) || (female ? 165 : 178);
  const kg = Number(avatar.weightKg) || (female ? 60 : 75);
  const person = female ? 'woman' : 'man';
  const hair =
    avatar.hairStyle === 'none'
      ? 'a shaved head'
      : `${HAIR_WORDS[avatar.hairStyle] || 'short'} ${HAIR_COLOR_WORDS[avatar.hairColor] || 'dark brown'} hair`;
  const base = 'a plain fitted white tank top and plain grey cotton shorts';
  return [
    `Full body studio fashion photo of a real ${buildWord(cm, kg)} ${person}, about ${cm} cm tall,`,
    `${SKIN_WORDS[avatar.skin] || 'medium'} skin, ${hair}, natural realistic face and skin texture,`,
    `standing straight facing the camera, arms relaxed at the sides, head to toe in frame, wearing ${base}`,
    'and plain white sneakers, plain light grey seamless backdrop, soft even studio lighting, sharp focus.',
  ].join(' ');
}

const TRYON_CATEGORY = {
  tee: 'tops', longsleeve: 'tops', tank: 'tops', sweater: 'tops', hoodie: 'tops', jacket: 'tops', coat: 'tops',
  pants: 'bottoms', shorts: 'bottoms', skirt: 'bottoms', dress: 'one-pieces',
};
// Dress first (it replaces both), then bottoms, then tops from the inside out.
const ORDER = { dress: 0, bottom: 1, base: 2, mid: 3, outer: 4 };
const SLOT = {
  tee: 'base', longsleeve: 'base', tank: 'base', sweater: 'mid', hoodie: 'mid', jacket: 'outer', coat: 'outer',
  pants: 'bottom', shorts: 'bottom', skirt: 'bottom', dress: 'dress',
};

/** The try-on steps for an outfit, in the order they're applied; shoes and hats are skipped. */
export function planSteps(pieces = []) {
  return pieces
    .filter((p) => TRYON_CATEGORY[p.kind] && p.image)
    .sort((a, b) => ORDER[SLOT[a.kind]] - ORDER[SLOT[b.kind]])
    .map((p) => ({
      title: p.title,
      category: TRYON_CATEGORY[p.kind],
      garment_image: p.image,
      garment_photo_type: p.packshot ? 'flat-lay' : 'model',
    }));
}

async function call(path, init = {}, fetchImpl = fetch) {
  const res = await fetchImpl(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.FASHN_API_KEY}`, ...init.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.error || `FASHN returned ${res.status}`;
    throw new RenderError(res.status === 401 ? 'The FASHN API key was rejected.' : String(msg), res.status === 429 ? 429 : 502);
  }
  return data;
}

/** Runs one FASHN model and waits for its first output URL. */
export async function runModel(model_name, inputs, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = 120000 } = {}) {
  const { id } = await call('/run', { method: 'POST', body: JSON.stringify({ model_name, inputs }) }, fetchImpl);
  if (!id) throw new RenderError('FASHN did not start the job.');
  const started = Date.now();
  for (;;) {
    await sleep(1500);
    const s = await call(`/status/${id}`, {}, fetchImpl);
    if (s.status === 'completed' && s.output?.length) return s.output[0];
    if (s.status === 'failed') {
      const name = s.error?.name;
      throw new RenderError(
        name === 'PoseError' ? 'The try-on couldn’t find a body pose in one of the photos. Try “Use this photo” on a different product photo.' : s.error?.message || 'The try-on failed.',
        422
      );
    }
    if (Date.now() - started > timeoutMs) throw new RenderError('The try-on took too long.', 504);
  }
}

// Base model photos by avatar, so changing clothes doesn't regenerate the person.
const baseCache = new Map();

export const avatarKey = (avatar = {}) =>
  createHash('sha1')
    .update(JSON.stringify([avatar.sex, avatar.heightCm, avatar.weightKg, avatar.skin, avatar.hairStyle, avatar.hairColor]))
    .digest('hex')
    .slice(0, 16);

/**
 * Renders the outfit. `modelImage` (a URL or data URI) is the user's own photo;
 * without it a person matching the avatar is generated once and reused.
 */
export async function renderOutfit({ avatar, pieces, modelImage, seed = 7 }, opts = {}) {
  const steps = planSteps(pieces);
  if (!steps.length) throw new RenderError('Put on a top, bottoms or a dress first. Shoes and hats can’t be photo-rendered yet.', 400);

  let model = modelImage;
  if (!model) {
    const key = avatarKey(avatar);
    if (!baseCache.has(key)) {
      const pending = runModel('model-create', { prompt: modelPrompt(avatar), aspect_ratio: '2:3', seed, output_format: 'jpeg' }, opts);
      baseCache.set(key, pending);
      pending.catch(() => baseCache.delete(key));
    }
    model = await baseCache.get(key);
  }

  let image = model;
  for (const step of steps) {
    image = await runModel(
      'tryon-v1.6',
      {
        model_image: image,
        garment_image: step.garment_image,
        category: step.category,
        garment_photo_type: step.garment_photo_type,
        mode: 'balanced',
        seed,
        output_format: 'jpeg',
      },
      opts
    );
  }
  return { image, base: model, skipped: pieces.filter((p) => !TRYON_CATEGORY[p.kind]).map((p) => p.title) };
}
