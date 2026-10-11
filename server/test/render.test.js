import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSteps, modelPrompt, renderOutfit } from '../src/render.js';

test('try-on steps go dress, bottoms, then tops inside out; shoes are skipped', () => {
  const steps = planSteps([
    { kind: 'jacket', image: 'j', title: 'Jacket' },
    { kind: 'shoes', image: 's', title: 'Shoes' },
    { kind: 'tee', image: 't', title: 'Tee', packshot: true },
    { kind: 'pants', image: 'p', title: 'Pants' },
  ]);
  assert.deepEqual(steps.map((s) => s.garment_image), ['p', 't', 'j']);
  assert.equal(steps[1].garment_photo_type, 'flat-lay');
  assert.equal(steps[0].category, 'bottoms');
});

test('the generated person matches the avatar', () => {
  const p = modelPrompt({ sex: 'female', heightCm: 165, weightKg: 58, skin: 'deep', hairStyle: 'long', hairColor: '#1b1512' });
  assert.match(p, /woman/);
  assert.match(p, /deep brown skin/);
  assert.match(p, /long black hair/);
});

test('renders by chaining FASHN jobs and reuses the base person', async () => {
  process.env.FASHN_API_KEY = 'test';
  const runs = [];
  let n = 0;
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/run')) {
      runs.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ id: `job${++n}` }) };
    }
    const id = url.split('/').pop();
    return { ok: true, json: async () => ({ status: 'completed', output: [`https://cdn.test/${id}.jpg`] }) };
  };
  const opts = { fetchImpl, sleep: async () => {} };
  const avatar = { sex: 'male', heightCm: 180, weightKg: 80, skin: 'tan', hairStyle: 'short', hairColor: '#3b2618' };
  const pieces = [
    { kind: 'sweater', image: 'data:image/jpeg;base64,AA', title: 'Sweater', packshot: true },
    { kind: 'pants', image: 'data:image/jpeg;base64,BB', title: 'Pants' },
  ];
  const out = await renderOutfit({ avatar, pieces }, opts);
  assert.deepEqual(runs.map((r) => r.model_name), ['model-create', 'tryon-v1.6', 'tryon-v1.6']);
  assert.equal(runs[1].inputs.category, 'bottoms');
  assert.equal(runs[2].inputs.model_image, 'https://cdn.test/job2.jpg', 'sweater goes on the pants result');
  assert.equal(out.image, 'https://cdn.test/job3.jpg');
  await renderOutfit({ avatar, pieces: [pieces[0]] }, opts);
  assert.equal(runs.filter((r) => r.model_name === 'model-create').length, 1, 'person generated once');
});
