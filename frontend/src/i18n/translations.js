// Scoped bilingual dictionary — covers the high-visibility government
// branding/navigation strings, not the entire app. Kept intentionally small:
// a short, correct translation set beats a large, error-prone one.
export const translations = {
  govtOfTN:        { en: 'Government of Tamil Nadu',   ta: 'தமிழ்நாடு அரசு' },
  nhm:              { en: 'National Health Mission',    ta: 'தேசிய சுகாதார இயக்கம்' },
  emergencyServices:{ en: '108 Emergency Services',      ta: '108 அவசர சேவைகள்' },
  freeTagline:      { en: 'Free · 24/7 · Chennai City',  ta: 'இலவசம் · 24/7 · சென்னை நகரம்' },
  callBtn:          { en: 'Call 108',                    ta: '108-ஐ அழைக்கவும்' },

  navRequest:       { en: 'Request Ambulance',           ta: 'ஆம்புலன்ஸ் கோரிக்கை' },
  navDriver:        { en: 'Driver Portal',                ta: 'ஓட்டுநர் போர்ட்டல்' },
  navAdmin:         { en: 'Control Room',                 ta: 'கட்டுப்பாட்டு அறை' },

  heroEmergencyWord:{ en: 'Emergency',                   ta: 'அவசர' },
  heroAmbulanceWord:{ en: 'Ambulance',                    ta: 'ஆம்புலன்ஸ்' },
  heroDesc: {
    en: "Chennai's free emergency medical service, available 24/7 across the city.",
    ta: 'சென்னையின் இலவச அவசர மருத்துவ சேவை, நகரம் முழுவதும் 24 மணி நேரமும் கிடைக்கும்.',
  },
  heroDescTail: {
    en: 'or request online — the nearest ambulance is dispatched within seconds.',
    ta: 'அல்லது ஆன்லைனில் கோரிக்கை அனுப்பவும் — நெருங்கிய ஆம்புலன்ஸ் விநாடிகளில் அனுப்பப்படும்.',
  },
  heroCTA:          { en: 'Request Ambulance',            ta: 'ஆம்புலன்ஸ் கோரவும்' },
  heroDriverCTA:    { en: 'Driver Login',                  ta: 'ஓட்டுநர் உள்நுழைவு' },

  ourServices:      { en: 'Our Services',                 ta: 'எங்கள் சேவைகள்' },
  footerHealthDept: { en: 'Health & Family Welfare Dept.', ta: 'சுகாதாரம் மற்றும் குடும்ப நலத்துறை' },
  skipToContent:    { en: 'Skip to main content',          ta: 'முதன்மை உள்ளடக்கத்திற்குச் செல்' },
};

export function translate(lang, key) {
  return translations[key]?.[lang] ?? translations[key]?.en ?? key;
}
