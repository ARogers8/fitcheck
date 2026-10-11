export async function importPiece(body) {
  const res = await fetch('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: `Import failed (${res.status}).` }));
  if (!res.ok) {
    const err = new Error(data.error || `Import failed (${res.status}).`);
    err.blocked = data.blocked;
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Shrinks an uploaded photo and returns it as a data URL. */
export function fileToDataUrl(file, max = 1400) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = reject;
    img.src = url;
  });
}

export const proxied = (url, ref) => `/api/image?url=${encodeURIComponent(url)}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`;

export function formatPrice(price, currency) {
  if (price == null || Number.isNaN(price)) return '';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(price);
  } catch {
    return `$${Number(price).toFixed(2)}`;
  }
}
