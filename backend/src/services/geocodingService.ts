import axios from 'axios';

const BQ_BBOX = '10.82,-74.98,11.08,-74.62';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function streetRegex(name: string): string {
  return name
    .replace(/^Carrera\s+/i,     '(Carrera|Cra\\.?|CRA|Cr\\.?)\\s*')
    .replace(/^Calle\s+/i,       '(Calle|Cl\\.?|CL)\\s*')
    .replace(/^Diagonal\s+/i,    '(Diagonal|Diag\\.?|Dg\\.?)\\s*')
    .replace(/^Transversal\s+/i, '(Transversal|Tv\\.?|TV)\\s*')
    .replace(/^Avenida\s+/i,     '(Avenida|Av\\.?|AV)\\s*')
    .replace(/^Vía\s+/i,         '(Vía|Via)\\s*')
    + '$';
}

export async function geocodeViaOverpass(street1: string, street2: string): Promise<[number, number] | null> {
  const r1 = streetRegex(street1);
  const r2 = streetRegex(street2);
  const query = `[out:json][timeout:5][bbox:${BQ_BBOX}];
way["name"~"${r1}",i]["highway"]->.s1;
way["name"~"${r2}",i]["highway"]->.s2;
node(w.s1)(w.s2);
out 1;`;
  try {
    const res = await axios.post<{ elements: { lat: number; lon: number }[] }>(
      'https://overpass-api.de/api/interpreter',
      query,
      { headers: { 'Content-Type': 'text/plain' }, timeout: 6000 }
    );
    if (res.data.elements.length > 0) return [res.data.elements[0].lat, res.data.elements[0].lon];
  } catch { /* fall through */ }
  return null;
}

export async function geocodeViaGoogle(intersection: string, city: string): Promise<[number, number] | null> {
  const key = process.env.VITE_GOOGLE_MAPS_KEY;
  if (!key) return null;
  const allCities = [...new Set([city, 'Barranquilla', 'Soledad', 'Malambo', 'Puerto Colombia'])];
  for (const c of allCities) {
    try {
      const res = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
        params: { address: `${intersection}, ${c}, Colombia`, key, region: 'co' },
        timeout: 5000,
      });
      const results = (res.data as any).results as { geometry: { location: { lat: number; lng: number } } }[];
      if (results?.length > 0) {
        const { lat, lng } = results[0].geometry.location;
        if (lat > 10.7 && lat < 11.2 && lng > -75.1 && lng < -74.5) return [lat, lng];
      }
    } catch { /* try next */ }
  }
  return null;
}

export async function geocodeViaNominatim(street1: string, street2: string, city = 'Barranquilla'): Promise<[number, number] | null> {
  const numMatch = street2.match(/[\dA-Za-z]+$/);
  const num = numMatch ? numMatch[0] : '';
  const queries = [
    `${street1} con ${street2}, ${city}, Colombia`,
    `${street1} #${num}, ${city}, Colombia`,
    `${street1} y ${street2}, ${city}, Colombia`,
    `${street1} con ${street2}, Barranquilla, Colombia`,
    `${street1}, ${city}, Colombia`,
  ];
  for (const q of queries) {
    try {
      await sleep(1000);
      const res = await axios.get<{ lat: string; lon: string }[]>(
        'https://nominatim.openstreetmap.org/search',
        {
          params: { q, format: 'json', limit: 1, bounded: 1, viewbox: '-74.98,11.08,-74.62,10.82' },
          headers: { 'User-Agent': 'co.mibus.admin/1.0' },
          timeout: 8000,
        }
      );
      if (res.data.length > 0) return [parseFloat(res.data[0].lat), parseFloat(res.data[0].lon)];
    } catch { /* try next */ }
  }
  return null;
}

/**
 * Geocodifica una lista de strings "Calle X con Carrera Y, Municipio".
 * Overpass → Google → Nominatim como fallbacks.
 * Retorna los waypoints geocodificados y los que fallaron.
 */
export async function geocodeIntersectionList(intersections: string[]): Promise<{
  waypoints: [number, number][];
  failed: string[];
}> {
  const parts = intersections.map(i => {
    const commaIdx = i.lastIndexOf(', ');
    const city = commaIdx >= 0 ? i.slice(commaIdx + 2) : 'Barranquilla';
    const intersection = commaIdx >= 0 ? i.slice(0, commaIdx) : i;
    const p = intersection.split(/\s+con\s+/i);
    return p.length === 2 ? { street1: p[0].trim(), street2: p[1].trim(), city } : null;
  });

  // Overpass en paralelo
  const overpassResults = await Promise.all(
    parts.map(p => p ? geocodeViaOverpass(p.street1, p.street2) : Promise.resolve(null))
  );

  // Google Maps para los que Overpass no encontró
  const googleNeeded = parts.map((p, i) => (!overpassResults[i] && p ? i : -1)).filter(i => i >= 0);
  const googleResults: ([number, number] | null)[] = new Array(parts.length).fill(null);
  if (googleNeeded.length > 0) {
    const batch = await Promise.all(
      googleNeeded.map(i => {
        const p = parts[i]!;
        return geocodeViaGoogle(`${p.street1} con ${p.street2}`, p.city);
      })
    );
    googleNeeded.forEach((idx, bi) => { googleResults[idx] = batch[bi]; });
  }

  // Nominatim como último fallback (secuencial, rate-limited)
  const waypoints: [number, number][] = [];
  const failed: string[] = [];

  for (let i = 0; i < intersections.length; i++) {
    let coords = overpassResults[i] ?? googleResults[i];
    if (!coords && parts[i]) {
      coords = await geocodeViaNominatim(parts[i]!.street1, parts[i]!.street2, parts[i]!.city);
    }
    if (coords) waypoints.push(coords);
    else failed.push(intersections[i]);
  }

  return { waypoints, failed };
}
