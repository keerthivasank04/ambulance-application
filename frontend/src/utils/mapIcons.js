import L from 'leaflet';

// Shared Leaflet marker icons — used by both the citizen-facing live
// tracking map and the admin fleet map, so a unit looks the same
// everywhere in the app instead of two different visual languages.

const AMBULANCE_SVG = `
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
    <rect x="1" y="8" width="15" height="8" rx="1.5" fill="currentColor"/>
    <rect x="15" y="10" width="7" height="6" rx="1" fill="currentColor"/>
    <rect x="6.2" y="10.2" width="5.6" height="1.6" fill="white"/>
    <rect x="8.2" y="8.2" width="1.6" height="5.6" fill="white"/>
    <circle cx="6" cy="17.5" r="1.8" fill="#1F2937"/>
    <circle cx="18" cy="17.5" r="1.8" fill="#1F2937"/>
  </svg>`;

const HOSPITAL_SVG = `
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
    <rect x="9.5" y="3" width="5" height="18" rx="1" fill="currentColor"/>
    <rect x="3" y="9.5" width="18" height="5" rx="1" fill="currentColor"/>
  </svg>`;

const PATIENT_SVG = `
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="7.5" r="4" fill="currentColor"/>
    <path d="M4.5 21c0-4.1 3.4-7.5 7.5-7.5s7.5 3.4 7.5 7.5" fill="currentColor"/>
  </svg>`;

const makeBadge = (glyphSvg, color, size = 30, pulse = false) => L.divIcon({
  className: '',
  html: `
    <div style="position:relative;width:${size}px;height:${size}px">
      <div style="
        position:absolute;inset:0;
        background:white;
        border-radius:50%;
        border:2.5px solid ${color};
        box-shadow:0 2px 8px rgba(0,0,0,0.3);
        display:flex;align-items:center;justify-content:center;
        color:${color};
      ">${glyphSvg}</div>
      ${pulse ? `<div style="
        position:absolute;inset:-6px;
        border-radius:50%;
        border:2px solid ${color};
        opacity:0.55;
        animation:pulse-ring 1.6s ease-out infinite;
      "></div>` : ''}
    </div>
  `,
  iconSize: [size, size],
  iconAnchor: [size / 2, size / 2],
});

// Ambulance badge with an optional compass-style direction wedge that
// rotates to face the way the vehicle is actually moving (bearing 0 =
// north/up) — the same visual language Rapido/Uber-style tracking uses.
export const ambulanceIcon = (color, pulse = false, bearing = null, size = 32) => {
  const wedge = bearing == null ? '' : `
    <div style="
      position:absolute;left:50%;top:50%;width:0;height:0;
      transform:translate(-50%,-50%) rotate(${bearing}deg) translateY(-${size / 2 + 6}px);
      border-left:6px solid transparent;border-right:6px solid transparent;
      border-bottom:9px solid ${color};
      transition:transform 0.4s ease;
    "></div>`;
  return L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:${size}px;height:${size}px">
        ${wedge}
        <div style="position:absolute;inset:0;background:white;border-radius:50%;border:2.5px solid ${color};box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:${color};">
          ${AMBULANCE_SVG}
        </div>
        ${pulse ? `<div style="
          position:absolute;inset:-6px;border-radius:50%;border:2px solid ${color};
          opacity:0.55;animation:pulse-ring 1.6s ease-out infinite;
        "></div>` : ''}
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
};

export const hospitalIcon = () => makeBadge(HOSPITAL_SVG, '#16A34A', 28);
export const patientIcon  = () => makeBadge(PATIENT_SVG, '#DC2626', 26);

export const signalMarkerIcon = (status) => {
  const c = status === 'green_corridor' ? '#16A34A' : '#94A3B8';
  return L.divIcon({
    className: '',
    html: `<div style="width:11px;height:18px;background:${c};border-radius:3px;border:1.5px solid white;box-shadow:0 0 6px ${c}90;"></div>`,
    iconSize: [11, 18], iconAnchor: [5.5, 18],
  });
};

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
