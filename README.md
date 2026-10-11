# Fitcheck

Try on clothes from any store on your own 3D model. Paste a link to a single piece
(Zara pants, an Abercrombie sweater, PacSun sneakers…), pick your size, and see the
pieces together head to toe. Every piece is saved in the sidebar with a link back to
buy it.

## Run it

Needs Node 20+.

```bash
npm run install:all   # installs server and client
npm run dev           # API on :8787, app on http://localhost:5173
```

Production build: `npm run build && npm start` (the API serves the built app on :8787).

Optional: set `ANTHROPIC_API_KEY` before starting the server. With it, Claude looks
at each product's photos and boxes out the exact piece, so the other clothes a model
is wearing never end up on your avatar. Without it, Fitcheck uses photo heuristics.

## What it does

- **Your model**: male or female body, nine skin tones, hair style and colour, height and
  weight. Drag to rotate 360°, scroll or pinch to zoom, jump to head-to-toe / top /
  bottom / shoes views.
- **Paste a link**: the server reads the product page (JSON-LD, Shopify product JSON,
  OpenGraph tags, then the visible size picker and gallery) for the name, brand, price,
  every listed size and every product photo.
- **The right piece**: the title decides what kind of garment it is (sweater, trousers,
  dress, shoes…). Photos of the piece on its own (flat lay / packshot) are preferred.
  When only model shots exist, Fitcheck crops to where that kind of garment sits and
  removes the model's skin and the backdrop, or uses Claude's box when vision is on.
- **On the body**: each piece is built as a 3D layer around the body (base, mid, outer,
  bottoms, dress, shoes, hat) and the cut-out photo is warped onto it row by row, so
  prints, stripes and logos land where they are on the real piece. A back photo is
  used for the back when the store has one.
- **Sizes**: every size the store lists is selectable. Fitcheck estimates your
  measurements from height and weight, says how each size fits (snug, true to size,
  relaxed, oversized) and marks the best fit. Bigger sizes render roomier and longer;
  `32x30`-style sizes set the trouser length.
- **Saved pieces**: all pieces stay in this browser with price, size, a buy link and
  the original photos. Wearing a piece replaces whatever was in the same slot.

## When a store blocks it

Big retailers (Zara, Abercrombie, Gucci and others) often put product pages behind bot
protection, so the server's read can be refused. Fitcheck then offers:

1. **Send to Fitcheck bookmarklet**: drag it to your bookmarks bar once, then click it
   on any product page. It reads the page in your own browser and opens the piece in
   Fitcheck.
2. **Add by hand**: name, price, sizes, link and photos saved from the store.

## What's realistic today

This version shapes the garment around a parametric body and drapes the real product
photo over it. It looks right for colour, pattern, length, layering and roughly for
fit, but it is not physical cloth simulation: there are no wrinkles or folds that react
to the body, and very loose or structured pieces (puffers, pleated skirts) are
approximated. Photoreal try-on (the piece looking exactly like the product photo on
your body) needs an image-generation try-on model or a cloth simulator fed with the
garment's pattern; both are possible next steps.

## Layout

```
server/   Express API: page reading, photo cut-outs (sharp), optional Claude vision
client/   React + three.js (react-three-fiber) app
```

`npm test` runs the server tests (page parsing, garment type detection, cut-outs).
