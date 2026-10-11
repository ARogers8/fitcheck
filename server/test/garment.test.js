import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { buildGarment, analyzePhoto, CACHE_DIR } from '../src/garment.js';
import path from 'node:path';

const svg = (body, bg = '#ffffff') =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="${bg}"/>${body}</svg>`))
    .png()
    .toBuffer();

// A flat-lay sweater: body plus angled sleeves, navy on white.
const flatSweater = () =>
  svg(`<path d="M200 150 L400 150 L520 420 L470 440 L400 300 L400 650 L200 650 L200 300 L130 440 L80 420 Z" fill="#1f2a4a"/>`);

// A model shot: skin head/arms/feet, red top, blue jeans, on a light grey wall.
const modelShot = () =>
  svg(
    `<circle cx="300" cy="70" r="50" fill="#d9a07a"/>
     <rect x="200" y="120" width="200" height="270" fill="#c0262d"/>
     <rect x="160" y="130" width="40" height="230" fill="#d9a07a"/>
     <rect x="400" y="130" width="40" height="230" fill="#d9a07a"/>
     <rect x="205" y="380" width="190" height="370" fill="#2f4f8f"/>
     <rect x="205" y="750" width="190" height="40" fill="#d9a07a"/>`,
    '#ececea'
  );

test('flat-lay photos are recognised and cut out', async () => {
  const a = await analyzePhoto(await flatSweater());
  assert.ok(a.packshot, 'flat lay is a packshot');
  const g = await buildGarment([{ url: 'https://x.test/flat.png', buffer: await flatSweater() }], 'sweater');
  assert.ok(g.textures.front, 'front texture made');
  const meta = await sharp(path.join(CACHE_DIR, g.textures.front.file)).metadata();
  assert.equal(meta.hasAlpha, true);
  assert.ok(meta.width > meta.height * 0.6, 'cutout keeps the sleeves');
  assert.equal(g.color, '#1f2a4a');
});

test('model shots keep only the requested piece', async () => {
  const buf = await modelShot();
  const a = await analyzePhoto(buf);
  assert.ok(!a.packshot, 'model shot is not a packshot');
  const pants = await buildGarment([{ url: 'https://x.test/model.png', buffer: buf }], 'pants');
  assert.equal(pants.color, '#2f4f8f', 'jeans colour, not the red top');
  const top = await buildGarment([{ url: 'https://x.test/model.png', buffer: buf }], 'tee');
  assert.equal(top.color, '#c0262d', 'top colour, not the jeans');
});

test('vision boxes override the default photo band', async () => {
  const buf = await modelShot();
  const g = await buildGarment([{ url: 'https://x.test/model2.png', buffer: buf }], 'pants', [
    { index: 0, containsItem: true, shot: 'model', view: 'front', box: [0.3, 0.15, 0.7, 0.48] },
  ]);
  assert.equal(g.color, '#c0262d');
});

test('beige garments are not mistaken for skin', async () => {
  const packshot = await svg(`<path d="M180 60 L420 60 L440 160 L500 760 L330 760 L300 330 L270 760 L100 760 L160 160 Z" fill="#c8b08a"/>`);
  assert.ok((await analyzePhoto(packshot)).packshot, 'beige trousers alone are a packshot');
  const worn = await svg(
    `<circle cx="300" cy="70" r="50" fill="#8a5a3c"/><rect x="200" y="120" width="200" height="260" fill="#c0262d"/>
     <path d="M200 370 L400 370 L430 780 L320 780 L300 520 L280 780 L170 780 Z" fill="#c8b08a"/>`,
    '#e8e4de'
  );
  const g = await buildGarment([{ url: 'https://x.test/beige.png', buffer: worn }], 'pants');
  assert.equal(g.color, '#c8b08a');
});

test('cutout alpha is opaque inside the garment and clear outside', async () => {
  const g = await buildGarment([{ url: 'https://x.test/alpha.png', buffer: await flatSweater() }], 'sweater');
  const { data, info } = await sharp(path.join(CACHE_DIR, g.textures.front.file)).raw().toBuffer({ resolveWithObject: true });
  const at = (fx, fy) => data[(Math.floor(fy * info.height) * info.width + Math.floor(fx * info.width)) * 4 + 3];
  assert.ok(at(0.5, 0.6) > 240, 'centre of the sweater is opaque');
  assert.ok(at(0.02, 0.97) < 15, 'corner outside the sweater is transparent');
});

test('white products on white backgrounds survive the cut-out', async () => {
  const shoe = await sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#ffffff"/>
      <path d="M90 330 Q120 210 260 200 L420 170 Q470 160 500 210 L640 290 Q720 310 720 350 L720 380 L90 380 Z" fill="#f2f2f2"/>
      <rect x="85" y="378" width="640" height="34" rx="12" fill="#e2dccf"/></svg>`)
  ).jpeg({ quality: 90 }).toBuffer();
  const g = await buildGarment([{ url: 'https://x.test/shoe.jpg', buffer: shoe }], 'shoes');
  const meta = await sharp(path.join(CACHE_DIR, g.textures.front.file)).metadata();
  assert.ok(meta.height > meta.width * 0.3, `whole shoe kept (${meta.width}x${meta.height})`);
});

test('a striped cream packshot beats a lifestyle photo listed first (Zara case)', async () => {
  // Lifestyle: model in the sweater outdoors, busy two-tone background.
  const lifestyle = await svg(
    `<rect width="600" height="400" fill="#7a8f6a"/><rect y="400" width="600" height="400" fill="#9a8a70"/>
     <circle cx="300" cy="80" r="55" fill="#d9a07a"/>
     <rect x="190" y="140" width="220" height="280" fill="#ede6d6"/>
     <rect x="190" y="200" width="220" height="18" fill="#3a5a9a"/>
     <rect x="190" y="290" width="220" height="18" fill="#3a5a9a"/>
     <rect x="200" y="420" width="200" height="360" fill="#2b2b2b"/>`,
    '#7a8f6a'
  );
  const stripes = Array.from({ length: 8 }, (_, k) => `<rect x="130" y="${200 + k * 60}" width="340" height="16" fill="#3a5a9a"/>`).join('');
  const packshot = await svg(
    `<ellipse cx="305" cy="690" rx="200" ry="30" fill="#dcdbd8"/>
     <path d="M200 150 L400 150 L520 440 L470 460 L470 680 L130 680 L130 460 L80 440 Z" fill="#ede6d6"/>${stripes}`,
    '#ebeae7'
  );
  const a = await analyzePhoto(packshot);
  assert.ok(a.packshot, `cream knit on warm grey is a packshot (skin ${a.skinFrac})`);
  const g = await buildGarment(
    [
      { url: 'https://static.zara.net/assets/public/aa/0001-e1/0001-e1.jpg?w=1024', buffer: lifestyle },
      { url: 'https://static.zara.net/assets/public/bb/0001-p/0001-p.jpg?w=1024', buffer: packshot },
    ],
    'sweater'
  );
  assert.equal(g.textures.front.source, 'https://static.zara.net/assets/public/bb/0001-p/0001-p.jpg?w=1024');
  assert.equal(g.textures.front.packshot, true);
});

test('without URL hints, the plain-background model shot beats the lifestyle one', async () => {
  const street = await svg(
    `<rect width="300" height="800" fill="#556b5a"/><circle cx="300" cy="80" r="55" fill="#d9a07a"/>
     <rect x="190" y="140" width="220" height="280" fill="#203050"/>`,
    '#a08a6a'
  );
  const studio = await svg(
    `<circle cx="300" cy="80" r="55" fill="#d9a07a"/><rect x="190" y="140" width="220" height="280" fill="#203050"/>`,
    '#efefef'
  );
  const g = await buildGarment(
    [
      { url: 'https://x.test/1.jpg', buffer: street },
      { url: 'https://x.test/2.jpg', buffer: studio },
    ],
    'sweater'
  );
  assert.equal(g.textures.front.source, 'https://x.test/2.jpg');
});
