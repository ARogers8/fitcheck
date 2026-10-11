// Optional: when ANTHROPIC_API_KEY is set, Claude looks at the product photos and
// says which ones show the exact item, which way each faces, and where the item
// is in the frame. This is what lets us ignore the other clothes a model is wearing.
// Without a key, garment.js falls back to photo heuristics.
import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { KINDS } from './category.js';

const MAX_PHOTOS = 8;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'photos'],
  properties: {
    kind: { type: 'string', enum: Object.keys(KINDS) },
    photos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'containsItem', 'shot', 'view', 'box'],
        properties: {
          index: { type: 'integer' },
          containsItem: { type: 'boolean' },
          shot: { type: 'string', enum: ['flat', 'ghost', 'model', 'other'] },
          view: { type: 'string', enum: ['front', 'back', 'side', 'detail', 'other'] },
          box: {
            type: 'array',
            items: { type: 'number' },
            description: '[x0, y0, x1, y1] of the target item only, as fractions 0..1 of image width/height',
          },
        },
      },
    },
  },
};

export function visionAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function locateGarment({ title, kind, photos }) {
  const client = new Anthropic();
  const content = [];
  const used = photos.slice(0, MAX_PHOTOS);
  for (const [i, p] of used.entries()) {
    const jpeg = await sharp(p.buffer, { failOn: 'none' })
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize(768, 768, { fit: 'inside' })
      .jpeg({ quality: 80 })
      .toBuffer();
    content.push({ type: 'text', text: `Photo ${i}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } });
  }
  content.push({
    type: 'text',
    text:
      `These are the product photos for "${title}" (our guess at its type: ${kind}). ` +
      `Models in these photos often wear other clothes too. For each photo, say whether the exact item "${title}" is visible, ` +
      `whether it's a flat lay / ghost-mannequin shot or worn by a model, which side of the item faces the camera, ` +
      `and give a tight box around that item only (not the other clothes, not the face or limbs). ` +
      `Also give the item's type from the allowed list. Use [0,0,1,1] when the item isn't visible.`,
  });

  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal') return null;
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) return null;
  const parsed = JSON.parse(text);
  const clamp = (v) => Math.min(1, Math.max(0, Number(v) || 0));
  return {
    kind: parsed.kind,
    hints: parsed.photos
      .filter((p) => p.index >= 0 && p.index < used.length)
      .map((p) => ({
        index: p.index,
        containsItem: p.containsItem,
        shot: p.shot,
        view: p.view,
        box: p.containsItem && p.box?.length === 4 ? p.box.map(clamp) : null,
      })),
  };
}
