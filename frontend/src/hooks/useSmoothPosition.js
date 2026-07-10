import { useEffect, useRef, useState } from 'react';

// Interpolates position updates over `duration` ms instead of snapping the
// marker straight to each new GPS fix, so movement reads as a continuous
// glide (like Rapido/Uber-style live tracking) rather than a jump every tick.
export function useSmoothPosition(targetLat, targetLng, duration = 1800) {
  const [pos, setPos] = useState(
    targetLat != null && targetLng != null ? { lat: targetLat, lng: targetLng } : null
  );
  const posRef = useRef(pos);
  const rafRef = useRef(null);

  useEffect(() => {
    if (targetLat == null || targetLng == null) return;
    const from = posRef.current || { lat: targetLat, lng: targetLng };
    const to = { lat: targetLat, lng: targetLng };
    if (from.lat === to.lat && from.lng === to.lng) return;

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const start = performance.now();

    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const next = { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t };
      posRef.current = next;
      setPos(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);

    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [targetLat, targetLng, duration]);

  return pos;
}

// Compass bearing (0-360, 0 = north) from point A to point B.
export function computeBearing(lat1, lng1, lat2, lng2) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
