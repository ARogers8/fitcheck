import { useEffect, useRef, useState } from 'react';
import { renderPhoto, fileToDataUrl } from '../api.js';
import { personPhoto, personKey } from '../photo/people.js';

// The main view: a photo of a real-looking person matching "Your model" (or the
// user's own photo), dressed in the outfit by a try-on model. Results are kept
// per look and outfit, so switching back and forth doesn't cost another render.
const PHOTO_KINDS = new Set(['tee', 'longsleeve', 'tank', 'sweater', 'hoodie', 'jacket', 'coat', 'pants', 'shorts', 'skirt', 'dress']);
const renders = new Map();

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function PhotoStage({ avatar, outfit, onShow3d }) {
  const [myPhoto, setMyPhoto] = useState(null);
  const [person, setPerson] = useState({ status: 'working' });
  const [dressed, setDressed] = useState({ status: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const fileRef = useRef(null);

  // Wait for the sliders to settle before asking for a new person.
  const look = useDebounced(personKey(avatar), 1200);
  const photoPieces = outfit.filter((p) => PHOTO_KINDS.has(p.kind));
  const skipped = outfit.filter((p) => !PHOTO_KINDS.has(p.kind)).map((p) => p.title);
  const outfitKey = useDebounced(JSON.stringify(photoPieces.map((p) => [p.id, p.kind, p.textures?.front?.source])), 600);

  useEffect(() => {
    if (myPhoto) {
      setPerson({ status: 'done', image: myPhoto, source: 'yours' });
      return undefined;
    }
    let live = true;
    setPerson((p) => ({ ...p, status: 'working' }));
    personPhoto(avatar)
      .then((out) => live && setPerson({ status: 'done', ...out }))
      .catch((e) => live && setPerson({ status: 'error', error: e.message }));
    return () => {
      live = false;
    };
  }, [look, myPhoto, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (person.status !== 'done' || !photoPieces.length) {
      setDressed({ status: 'idle' });
      return undefined;
    }
    const key = `${person.image.slice(-80)}|${outfitKey}`;
    if (renders.has(key)) {
      setDressed({ status: 'done', ...renders.get(key) });
      return undefined;
    }
    let live = true;
    setDressed({ status: 'working' });
    renderPhoto({ avatar, outfit: photoPieces, modelImage: person.image })
      .then((out) => {
        renders.set(key, out);
        if (live) setDressed({ status: 'done', ...out });
      })
      .catch((e) => live && setDressed({ status: 'error', error: e.message }));
    return () => {
      live = false;
    };
  }, [person.status, person.image, outfitKey, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (e) => {
    const f = e.target.files?.[0];
    if (f) setMyPhoto(await fileToDataUrl(f, 1400));
    e.target.value = '';
  };

  const shown = dressed.status === 'done' ? dressed.image : person.image;
  const busy = person.status === 'working' || dressed.status === 'working';
  const error = person.status === 'error' ? person.error : dressed.status === 'error' ? dressed.error : null;
  const what =
    person.status === 'working'
      ? myPhoto ? 'Loading your photo…' : 'Finding your model…'
      : `Putting on ${photoPieces.length} piece${photoPieces.length > 1 ? 's' : ''}…`;

  return (
    <div className="photo-stage">
      <div className="realistic-frame">
        {shown && <img className={busy ? 'dim' : ''} src={shown} alt={dressed.status === 'done' ? 'Your model in this outfit' : 'Your model'} />}
        {busy && (
          <div className="realistic-wait">
            <div className="spinner" />
            <p>{what}</p>
            <p className="hint">On the free models this can take a minute or two, longer if they’re busy.</p>
          </div>
        )}
        {error && !busy && (
          <div className="realistic-error">
            <p>{error}</p>
            <button onClick={() => setAttempt((n) => n + 1)}>Try again</button>{' '}
            <button onClick={onShow3d}>Show the 3D model</button>
          </div>
        )}
      </div>
      <div className="realistic-tools">
        <button onClick={() => fileRef.current?.click()}>{myPhoto ? 'Change my photo' : 'Use my own photo'}</button>
        {myPhoto && <button className="ghost" onClick={() => setMyPhoto(null)}>Use the model</button>}
        {dressed.status === 'done' && (
          <a className="ghost" href={dressed.image} target="_blank" rel="noreferrer">Open full size ↗</a>
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
      </div>
      {skipped.length > 0 && <p className="hint">Not shown in the photo yet: {skipped.join(', ')}. Switch to 3D to see them.</p>}
    </div>
  );
}
