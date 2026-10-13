// Photoreal try-on. Claude can read photos but not paint them, so the realistic
// picture comes from image-generation models: first a studio photo of a person
// matching the avatar, then each piece is put on in turn, bottoms before tops so
// layers stack. Three ways to run those models:
//
//   free (default)  Public Hugging Face Spaces: FLUX.1-schnell makes the person,
//                   IDM-VTON puts on tops, CatVTON bottoms and dresses. No key
//                   needed; a free HF_TOKEN raises the GPU quota. Can queue.
//   your own GPU    Run the same open models yourself and point TRYON_SPACE /
//                   TRYON_LOWER_SPACE / PERSON_SPACE at them (any Gradio URL).
//   FASHN           Paid API, fastest. Used when FASHN_API_KEY is set.
import { createHash } from 'node:crypto';
import { Client, handle_file } from '@gradio/client';

const API = 'https://api.fashn.ai/v1';

export const renderProvider = () => (process.env.FASHN_API_KEY ? 'fashn' : 'gradio');
// The free path needs no key, so photo renders are always offered.
export const renderAvailable = () => process.env.RENDER_DISABLED !== '1';

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
    `Full body studio fashion photo of a real ${buildWord(cm, kg)} ${person}, about ${Math.round(cm / 5) * 5} cm tall,`,
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

const round5 = (n) => Math.round((Number(n) || 0) / 5) * 5;

export const avatarKey = (avatar = {}) =>
  createHash('sha1')
    .update(JSON.stringify([avatar.sex, round5(avatar.heightCm), round5(avatar.weightKg), avatar.skin, avatar.hairStyle, avatar.hairColor]))
    .digest('hex')
    .slice(0, 16);

/** FASHN: paid API, one credit per image. */
export function fashnProvider(opts = {}) {
  return {
    name: 'fashn',
    makePerson: (prompt, seed) => runModel('model-create', { prompt, aspect_ratio: '2:3', seed, output_format: 'jpeg' }, opts),
    tryOn: (image, step, seed) =>
      runModel(
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
      ),
  };
}

const toBlob = async (image) => {
  if (image.startsWith('data:')) {
    const [head, b64] = image.split(',');
    return new Blob([Buffer.from(b64, 'base64')], { type: head.slice(5).split(';')[0] });
  }
  const res = await fetch(image);
  if (!res.ok) throw new RenderError('Couldn’t fetch an intermediate try-on image.');
  return res.blob();
};

/** First file a Gradio endpoint returned, as a data URI (Space URLs are short-lived). */
async function gradioImage(result) {
  const first = [].concat(result?.data?.[0] ?? [])[0];
  const url = typeof first === 'string' ? first : first?.url;
  if (!url) throw new RenderError('The try-on model returned no image.');
  const res = await fetch(url);
  if (!res.ok) throw new RenderError('Couldn’t download the try-on result.');
  const type = res.headers.get('content-type') || 'image/png';
  return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
}

const friendly = (err) => {
  const msg = String(err?.message || err);
  if (/quota|exceeded|ZeroGPU/i.test(msg)) {
    return new RenderError('The free try-on GPUs are out of quota for now. Add a free Hugging Face token (HF_TOKEN) on the server, wait a bit, or use your own GPU or FASHN.', 429);
  }
  if (/queue|too many|503|sleeping|paused|building/i.test(msg)) {
    return new RenderError('The free try-on model is busy or waking up. Try again in a minute.', 503);
  }
  return err instanceof RenderError ? err : new RenderError(`The image model failed: ${msg.slice(0, 200)}`);
};

/**
 * Open models behind Gradio apps: public Hugging Face Spaces by default, or your
 * own server running the same apps. `connect` is injectable for tests.
 */
export function gradioProvider({ connect = (src, o) => Client.connect(src, o) } = {}) {
  const token = process.env.HF_TOKEN || undefined;
  const clients = new Map();
  const app = (src) => {
    if (!clients.has(src)) {
      const c = connect(src, token ? { token } : {});
      clients.set(src, c);
      c.catch(() => clients.delete(src));
    }
    return clients.get(src);
  };
  const person = process.env.PERSON_SPACE || 'black-forest-labs/FLUX.1-schnell';
  const upper = process.env.TRYON_SPACE || 'yisol/IDM-VTON';
  const lower = process.env.TRYON_LOWER_SPACE || 'zhengchong/CatVTON';
  const editor = (blob) => ({ background: handle_file(blob), layers: [], composite: null });
  return {
    name: 'gradio',
    async makePerson(prompt, seed) {
      try {
        const c = await app(person);
        return await gradioImage(await c.predict('/infer', [prompt, seed, false, 768, 1152, 4]));
      } catch (err) {
        throw friendly(err);
      }
    },
    async tryOn(image, step, seed) {
      try {
        const [personBlob, garmentBlob] = await Promise.all([toBlob(image), toBlob(step.garment_image)]);
        if (step.category === 'tops' && !process.env.TRYON_LOWER_ONLY) {
          const c = await app(upper);
          // IDM-VTON: person editor, garment, description, auto-mask, auto-crop, steps, seed.
          return await gradioImage(
            await c.predict('/tryon', [editor(personBlob), handle_file(garmentBlob), step.title || 'clothing', true, true, 30, seed])
          );
        }
        const c = await app(lower);
        // CatVTON: person editor, cloth, upper/lower/overall, steps, guidance, seed, show type.
        const type = { tops: 'upper', bottoms: 'lower', 'one-pieces': 'overall' }[step.category];
        return await gradioImage(
          await c.predict('/submit_function', [editor(personBlob), handle_file(garmentBlob), type, 50, 2.5, seed, 'result only'])
        );
      } catch (err) {
        throw friendly(err);
      }
    },
  };
}

let defaultProvider = null;
const pickProvider = () => {
  const want = renderProvider();
  if (defaultProvider?.name !== want) defaultProvider = want === 'fashn' ? fashnProvider() : gradioProvider();
  return defaultProvider;
};

/** A photo of a real-looking person matching the avatar, made once per look and reused. */
export async function makePerson({ avatar, seed = 7 }, { provider = pickProvider() } = {}) {
  const key = `${provider.name}:${avatarKey(avatar)}`;
  if (!baseCache.has(key)) {
    const pending = provider.makePerson(modelPrompt(avatar), seed);
    baseCache.set(key, pending);
    pending.catch(() => baseCache.delete(key));
  }
  return baseCache.get(key);
}

/**
 * Renders the outfit. `modelImage` (a URL or data URI) is the user's own photo;
 * without it a person matching the avatar is generated once and reused.
 */
export async function renderOutfit({ avatar, pieces, modelImage, seed = 7 }, { provider = pickProvider() } = {}) {
  const steps = planSteps(pieces);
  if (!steps.length) throw new RenderError('Put on a top, bottoms or a dress first. Shoes and hats can’t be photo-rendered yet.', 400);

  let model = modelImage || (await makePerson({ avatar, seed }, { provider }));

  let image = model;
  for (const step of steps) image = await provider.tryOn(image, step, seed);
  return { image, provider: provider.name, skipped: pieces.filter((p) => !TRYON_CATEGORY[p.kind]).map((p) => p.title) };
}
