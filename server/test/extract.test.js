import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromHtml, fromShopifyJson, looksLikeSize } from '../src/extract.js';
import { detectKind } from '../src/category.js';

const ldPage = `<!doctype html><html><head>
<title>Wide-Leg Pleated Trousers | ZARA United States</title>
<meta property="og:site_name" content="ZARA">
<meta property="og:image" content="https://static.zara.net/photos/p1.jpg?ts=1&w=400">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
 {"@type":"BreadcrumbList","itemListElement":[{"name":"Man"},{"name":"Trousers"}]},
 {"@type":"ProductGroup","name":"WIDE-LEG PLEATED TROUSERS","brand":{"@type":"Brand","name":"ZARA"},
  "image":["https://static.zara.net/photos/p1.jpg?ts=1&w=400","https://static.zara.net/photos/p2.jpg?w=400"],
  "hasVariant":[
   {"@type":"Product","size":"28","offers":{"@type":"Offer","price":"59.90","priceCurrency":"USD"}},
   {"@type":"Product","size":"30","offers":{"@type":"Offer","price":"59.90","priceCurrency":"USD"}},
   {"@type":"Product","size":"32","offers":{"@type":"Offer","price":"59.90","priceCurrency":"USD"}}
  ]}]}</script></head><body></body></html>`;

test('reads JSON-LD product groups with variant sizes', () => {
  const p = extractFromHtml(ldPage, 'https://www.zara.com/us/en/x-p1.html');
  assert.equal(p.title, 'WIDE-LEG PLEATED TROUSERS');
  assert.equal(p.brand, 'ZARA');
  assert.equal(p.price, 59.9);
  assert.equal(p.currency, 'USD');
  assert.deepEqual(p.sizes, ['28', '30', '32']);
  assert.equal(p.images.length, 2, 'og:image duplicate of p1 is deduped');
  assert.match(p.images[0], /w=1400/);
  assert.deepEqual(p.breadcrumbs, ['Man', 'Trousers']);
});

const metaPage = `<html><head>
<meta property="og:title" content="Essential Cable Knit Crew Sweater | Abercrombie & Fitch">
<meta property="og:site_name" content="Abercrombie & Fitch">
<meta property="product:price:amount" content="$80.00">
<meta property="og:image" content="https://img.abercrombie.com/is/image/anf/KIC_120-1_prod1?wid=600">
</head><body>
<div class="product-gallery"><img src="https://img.abercrombie.com/is/image/anf/KIC_120-1_model1?wid=600" alt="model"></div>
<img src="https://img.abercrombie.com/logo.svg" alt="logo">
<img src="https://img.abercrombie.com/is/image/anf/OTHER_jeans?wid=600" alt="Recommended jeans">
<ul class="size-selector"><li><button>XS</button></li><li><button>S</button></li><li><button>M</button></li><li><button>L</button></li><li><button>Size Guide</button></li></ul>
</body></html>`;

test('falls back to meta tags and the size picker in the page', () => {
  const p = extractFromHtml(metaPage, 'https://www.abercrombie.com/shop/us/p/x');
  assert.equal(p.title, 'Essential Cable Knit Crew Sweater');
  assert.equal(p.price, 80);
  assert.deepEqual(p.sizes, ['XS', 'S', 'M', 'L']);
  assert.equal(p.images.length, 2);
  assert.ok(!p.images.some((i) => /OTHER_jeans|logo/.test(i)), 'unrelated images are skipped');
});

test('reads Shopify product JSON', () => {
  const p = fromShopifyJson(
    {
      title: 'Boxy Heavyweight Tee',
      vendor: 'PacSun',
      price: 3500,
      options: [{ name: 'Color', values: ['Black'] }, { name: 'Size', values: ['S', 'M', 'L'] }],
      images: ['//cdn.shopify.com/s/files/1/tee_600x.jpg', '//cdn.shopify.com/s/files/1/tee-back.jpg'],
    },
    'https://shop.example.com/products/boxy-tee'
  );
  assert.equal(p.price, 35);
  assert.deepEqual(p.sizes, ['S', 'M', 'L']);
  assert.match(p.images[0], /^https:\/\/cdn\.shopify\.com\/s\/files\/1\/tee\.jpg\?width=1400$/);
});

test('size tokens', () => {
  for (const s of ['XS', 'M', 'XXL', '32', '32x30', '32/34', 'EU 42', '10.5', 'One Size']) assert.ok(looksLikeSize(s), s);
  for (const s of ['Size Guide', 'Add to bag', 'Black']) assert.ok(!looksLikeSize(s), s);
});

test('garment kind from titles', () => {
  const cases = {
    'WIDE-LEG PLEATED TROUSERS': 'pants',
    'Essential Cable Knit Crew Sweater': 'sweater',
    'Short-Sleeve Linen Shirt': 'tee',
    'Oxford Button-Down Shirt': 'longsleeve',
    'Denim Shirt Jacket': 'jacket',
    'Satin Slip Dress': 'dress',
    'Baggy Jeans': 'pants',
    'Sweater Vest': 'tank',
    'Logo Hoodie': 'hoodie',
    'Leather Ace Sneaker': 'shoes',
    'Linen Shorts': 'shorts',
    'GG Wool Coat': 'coat',
  };
  for (const [title, kind] of Object.entries(cases)) assert.equal(detectKind({ title }), kind, title);
  assert.equal(detectKind({ title: 'The Everyday', breadcrumbs: ['Women', 'Skirts'] }), 'skirt');
});
