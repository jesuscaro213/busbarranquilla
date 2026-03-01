type OSRMResponse = {
  code: string;
  routes?: { geometry: { coordinates: [number, number][] } }[];
};

export type Stop = { latitude: number; longitude: number };
export type GeometryResult = { points: [number, number][]; hadFallbacks: boolean };

export async function fetchOSRMGeometry(
  stops: Stop[]
): Promise<GeometryResult | null> {
  const valid = stops.filter((s) => s.latitude && s.longitude);
  if (valid.length < 2) return null;

  // INTENTO 1: Ruta completa con todos los puntos
  try {
    const coords = valid.map((s) => `${s.longitude},${s.latitude}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await res.json() as OSRMResponse;
    if (data.code === 'Ok' && data.routes?.[0]) {
      const points = data.routes[0].geometry.coordinates.map(
        ([lng, lat]: [number, number]) => [lat, lng] as [number, number]
      );
      return { points, hadFallbacks: false };
    }
  } catch {
    // continuar con fallback por segmentos
  }

  // INTENTO 2: Segmento a segmento — fallback a línea recta por par que falle
  const allPoints: [number, number][] = [];
  let hadFallbacks = false;

  for (let i = 0; i < valid.length - 1; i++) {
    const from = valid[i];
    const to = valid[i + 1];

    try {
      const coords = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
      const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const data = await res.json() as OSRMResponse;

      if (data.code === 'Ok' && data.routes?.[0]) {
        const segmentPoints = data.routes[0].geometry.coordinates.map(
          ([lng, lat]: [number, number]) => [lat, lng] as [number, number]
        );
        if (allPoints.length > 0) segmentPoints.shift();
        allPoints.push(...segmentPoints);
      } else {
        hadFallbacks = true;
        if (allPoints.length === 0 || allPoints[allPoints.length - 1][0] !== from.latitude) {
          allPoints.push([from.latitude, from.longitude]);
        }
        allPoints.push([to.latitude, to.longitude]);
        console.warn(`OSRM: no route between stop ${i} and ${i + 1}, using straight line`);
      }
    } catch {
      hadFallbacks = true;
      if (allPoints.length === 0 || allPoints[allPoints.length - 1][0] !== from.latitude) {
        allPoints.push([from.latitude, from.longitude]);
      }
      allPoints.push([to.latitude, to.longitude]);
      console.warn(`OSRM: timeout on segment ${i}-${i + 1}, using straight line`);
    }

    if (i < valid.length - 2) {
      await new Promise<void>((r) => setTimeout(r, 200));
    }
  }

  return allPoints.length >= 2 ? { points: allPoints, hadFallbacks } : null;
}
