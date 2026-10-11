// Estimates body measurements (cm) from sex, height and weight.
// These are population-average proportions scaled by BMI; good enough to shape
// the avatar and compare against size charts until build sliders are added.

export const SKIN_TONES = [
  { id: 'porcelain', label: 'Porcelain', color: '#f6d7c3' },
  { id: 'light', label: 'Light', color: '#eac0a2' },
  { id: 'light-medium', label: 'Light medium', color: '#d9a47f' },
  { id: 'olive', label: 'Olive', color: '#c19069' },
  { id: 'medium', label: 'Medium', color: '#b07a52' },
  { id: 'tan', label: 'Tan', color: '#94603d' },
  { id: 'brown', label: 'Brown', color: '#784a2e' },
  { id: 'deep', label: 'Deep', color: '#5a3520' },
  { id: 'rich', label: 'Rich', color: '#3f2416' },
];

export const HAIR_STYLES = ['short', 'buzz', 'long', 'bun', 'none'];
export const HAIR_COLORS = ['#1b1512', '#3b2618', '#6b4428', '#a87945', '#d8b67c', '#8c8c8c', '#b5432c'];

export const DEFAULT_AVATAR = {
  sex: 'male',
  heightCm: 178,
  weightKg: 75,
  skin: 'light-medium',
  hairStyle: 'short',
  hairColor: '#3b2618',
  units: 'imperial',
};

export function bodyMeasurements({ sex, heightCm, weightKg }) {
  const H = heightCm;
  const female = sex === 'female';
  const bmi = weightKg / (H / 100) ** 2;
  const r = bmi / (female ? 21.5 : 22.5);
  return {
    heightCm: H,
    bmi,
    chest: H * (female ? 0.535 : 0.55) * r ** 0.55,
    underbust: H * 0.46 * r ** 0.6,
    waist: H * (female ? 0.425 : 0.47) * r ** 0.95,
    hip: H * (female ? 0.59 : 0.54) * r ** 0.6,
    thigh: H * (female ? 0.33 : 0.31) * r ** 0.7,
    knee: H * 0.215 * r ** 0.4,
    calf: H * 0.21 * r ** 0.5,
    ankle: H * 0.13 * r ** 0.25,
    upperArm: H * (female ? 0.16 : 0.17) * r ** 0.7,
    forearm: H * (female ? 0.14 : 0.152) * r ** 0.5,
    wrist: H * (female ? 0.088 : 0.098) * r ** 0.25,
    neck: H * (female ? 0.195 : 0.215) * r ** 0.4,
    shoulderWidth: H * (female ? 0.225 : 0.255) * r ** 0.12,
    inseam: H * (female ? 0.455 : 0.45),
    footLength: H * 0.152,
  };
}

/** Body landmarks as fractions of height (feet at 0). */
export const LANDMARKS = {
  ankle: 0.04,
  knee: 0.285,
  crotch: 0.465,
  hip: 0.505,
  waist: 0.61,
  bust: 0.715,
  armpit: 0.755,
  shoulder: 0.81,
  neckBase: 0.83,
  chin: 0.87,
  top: 1.0,
};

export const cmToFtIn = (cm) => {
  const inches = Math.round(cm / 2.54);
  return { ft: Math.floor(inches / 12), in: inches % 12 };
};
export const ftInToCm = (ft, inch) => (Number(ft) * 12 + Number(inch)) * 2.54;
export const kgToLb = (kg) => kg * 2.20462;
export const lbToKg = (lb) => lb / 2.20462;
