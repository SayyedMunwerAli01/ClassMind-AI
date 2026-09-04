export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

/**
 * ClassMind AI logo — served live through the wsrv.nl image proxy so it stays
 * consistent across every page without bundling an asset. Fetched at the
 * requested size (transparent PNG).
 */
const LOGO_FILE_ID = '1E6VoJ7GXw2szOrij9ncaJMw_aUlN3jc4'
export const LOGO_URL = (size = 256): string =>
  `https://wsrv.nl/?url=drive.google.com/uc?export=view%26id=${LOGO_FILE_ID}&w=${size}&h=${size}&fit=contain&cbg=none&output=png`

export const COLOR_PALETTE = [
  '#4A90D9', '#7B5EA7', '#E74C3C', '#27AE60',
  '#F39C12', '#1ABC9C', '#E91E63', '#9B59B6',
]

export const MINDMAP_COLORS = [
  '#4A90D9', '#7B5EA7', '#27AE60', '#E74C3C',
  '#F39C12', '#1ABC9C',
]

export const FALLBACK_MESSAGES = {
  en: 'This topic was not covered in today\'s lecture. Please refer to your textbook or ask your teacher.',
  ur: 'یہ موضوع آج کے لیکچر میں شامل نہیں تھا۔ براہ کرم اپنی نصابی کتاب دیکھیں یا اپنے استاد سے پوچھیں۔',
  romanUrdu: 'Yeh topic aaj ke lecture mein shamil nahi tha. Barah-e-karam apni nisabi kitab dekhein ya apne ustaad se poochhein.',
}

export const LECTURE_DURATIONS = {
  SHORT: 15,    // minutes
  MEDIUM: 30,   // minutes
  LONG: 45,     // minutes
  EXTENDED: 60, // minutes
}