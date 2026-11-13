import type { Property } from './api';

export type ApproximateCityGroup = {
  city: string;
  count: number;
  latitude: number;
  longitude: number;
};

const cityCenters: Record<string, { latitude: number; longitude: number }> = {
  tunis: { latitude: 36.8065, longitude: 10.1815 },
  ariana: { latitude: 36.8625, longitude: 10.1956 },
  'ben arous': { latitude: 36.7531, longitude: 10.2189 },
  manouba: { latitude: 36.808, longitude: 10.0972 },
  'la marsa': { latitude: 36.8782, longitude: 10.3247 },
  sousse: { latitude: 35.8256, longitude: 10.6084 },
  sfax: { latitude: 34.7406, longitude: 10.7603 },
  hammamet: { latitude: 36.4, longitude: 10.6167 },
  monastir: { latitude: 35.7643, longitude: 10.8113 },
  bizerte: { latitude: 37.2744, longitude: 9.8739 },
  nabeul: { latitude: 36.4513, longitude: 10.7357 },
  kairouan: { latitude: 35.6781, longitude: 10.0963 },
  gabes: { latitude: 33.8815, longitude: 10.0982 },
  mahdia: { latitude: 35.5047, longitude: 11.0622 },
  tozeur: { latitude: 33.9197, longitude: 8.1335 },
  tataouine: { latitude: 32.9297, longitude: 10.4518 },
  djerba: { latitude: 33.8076, longitude: 10.8451 },
  'houmt souk': { latitude: 33.875, longitude: 10.857 },
  medenine: { latitude: 33.3549, longitude: 10.5055 },
  beja: { latitude: 36.7256, longitude: 9.1817 },
  jendouba: { latitude: 36.5011, longitude: 8.7802 },
  siliana: { latitude: 36.08497, longitude: 9.37082 },
  zaghouan: { latitude: 36.4029, longitude: 10.1429 },
  kef: { latitude: 36.1742, longitude: 8.7049 },
  kasserine: { latitude: 35.1676, longitude: 8.8365 },
  sidi: { latitude: 35.0382, longitude: 9.4849 },
  gafsa: { latitude: 34.425, longitude: 8.7842 },
};

function canonicalCityName(value: string): string {
  const normalized = value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ');
  const aliases: Record<string, string> = {
    'tunis ville': 'tunis',
    'tunis centre': 'tunis',
    'la marsa': 'la marsa',
    'ile de djerba': 'djerba',
    'sidi bouzid': 'sidi',
    'el kef': 'kef',
  };
  return aliases[normalized] ?? normalized;
}

export function groupPropertiesByApproximateCity(
  properties: Property[],
): ApproximateCityGroup[] {
  const grouped = new Map<string, { city: string; count: number }>();
  for (const property of properties) {
    const city = property.city.trim();
    const canonicalName = canonicalCityName(city);
    if (!city || !cityCenters[canonicalName]) continue;
    const current = grouped.get(canonicalName);
    if (current) current.count += 1;
    else grouped.set(canonicalName, { city, count: 1 });
  }
  return [...grouped.entries()].map(([key, group]) => ({
    ...group,
    ...cityCenters[key],
  }));
}
