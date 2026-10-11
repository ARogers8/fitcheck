// Works out what kind of garment a product is from its title and breadcrumbs.
// The kind decides which 3D shape it's drawn as, which outfit slot it fills,
// and where in a model photo to look for it.

// Order matters: earlier rules win (a "shirt dress" is a dress, a "sweater vest" is a tank).
const RULES = [
  { kind: 'dress', re: /\b(dress|gown|jumpsuit|romper|playsuit)\b/ },
  { kind: 'coat', re: /\b(coat|trench|parka|overcoat|puffer|peacoat)\b/ },
  { kind: 'jacket', re: /\b(jacket|blazer|bomber|windbreaker|anorak|shacket|overshirt|gilet|vest jacket)\b/ },
  { kind: 'hoodie', re: /\b(hoodie|hooded|zip[- ]?up)\b/ },
  { kind: 'tank', re: /\b(tank|cami|camisole|vest|sleeveless|bralette|bra top|tube top)\b/ },
  { kind: 'sweater', re: /\b(sweater|jumper|pullover|cardigan|knit|crewneck sweatshirt|sweatshirt|crew neck|crewneck|fleece)\b/ },
  { kind: 'shorts', re: /\b(shorts|short|bermuda|trunks)\b/ },
  { kind: 'skirt', re: /\b(skirt|skort)\b/ },
  { kind: 'pants', re: /\b(pants?|jeans?|trousers?|chinos?|joggers?|sweatpants|leggings|slacks|cargos?|denim|flares?|culottes|bottoms)\b/ },
  { kind: 'longsleeve', re: /\b(long[- ]sleeve|longsleeve|shirt|button[- ]?(up|down)|oxford|flannel|blouse|henley|rugby|turtleneck|mock neck)\b/ },
  { kind: 'tee', re: /\b(t-?shirt|tee|polo|top|baby tee|crop top)\b/ },
  { kind: 'shoes', re: /\b(shoes?|sneakers?|trainers?|boots?|loafers?|heels?|sandals?|slides?|mules?|clogs?|flats?|oxfords|derbies)\b/ },
  { kind: 'hat', re: /\b(hat|cap|beanie|beret|bucket)\b/ },
];

export const KINDS = {
  tee: { slot: 'base', label: 'T-shirt / top' },
  longsleeve: { slot: 'base', label: 'Shirt / long sleeve' },
  tank: { slot: 'base', label: 'Tank / sleeveless' },
  sweater: { slot: 'mid', label: 'Sweater / knit' },
  hoodie: { slot: 'mid', label: 'Hoodie' },
  jacket: { slot: 'outer', label: 'Jacket' },
  coat: { slot: 'outer', label: 'Coat' },
  pants: { slot: 'bottom', label: 'Pants / jeans' },
  shorts: { slot: 'bottom', label: 'Shorts' },
  skirt: { slot: 'bottom', label: 'Skirt' },
  dress: { slot: 'dress', label: 'Dress / one-piece' },
  shoes: { slot: 'shoes', label: 'Shoes' },
  hat: { slot: 'hat', label: 'Hat' },
};

/** Vertical band (fraction of a full-body photo) where each kind usually sits. */
export const PHOTO_BANDS = {
  tee: [0.14, 0.52],
  longsleeve: [0.14, 0.55],
  tank: [0.14, 0.5],
  sweater: [0.13, 0.56],
  hoodie: [0.08, 0.56],
  jacket: [0.12, 0.6],
  coat: [0.12, 0.8],
  pants: [0.42, 0.97],
  shorts: [0.42, 0.7],
  skirt: [0.42, 0.78],
  dress: [0.14, 0.85],
  shoes: [0.86, 1.0],
  hat: [0.0, 0.14],
};

/** Returns a KINDS key, or null when nothing in the text names a garment. */
export function detectKind({ title = '', breadcrumbs = [], description = '' }) {
  const tryText = (text) => {
    const t = String(text).toLowerCase().replace(/short[- ]sleeved?/g, 'shortsleeve');
    // The latest match wins, so the product noun beats modifiers ("Shirt Jacket" -> jacket).
    let best = null;
    for (const r of RULES) {
      // Allow plurals ("Skirts", "Dresses") without spelling them out in every rule.
      const matches = [...t.matchAll(new RegExp(r.re.source.replace(/\)\\b$/, ')(?:e?s)?\\b'), 'g'))];
      if (!matches.length) continue;
      const pos = matches[matches.length - 1].index;
      if (!best || pos > best.pos || (pos === best.pos && RULES.indexOf(r) < RULES.indexOf(best.rule))) {
        best = { rule: r, pos };
      }
    }
    let kind = best?.rule.kind ?? null;
    if (kind === 'longsleeve' && t.includes('shortsleeve')) kind = 'tee';
    return kind;
  };
  // English product titles end with the noun ("Relaxed Cable Knit Sweater"), so the
  // last match in the title is the strongest signal; breadcrumbs back it up.
  return (
    tryText(title) ||
    tryText(breadcrumbs.join(' ')) ||
    tryText(description.slice(0, 300))
  );
}
