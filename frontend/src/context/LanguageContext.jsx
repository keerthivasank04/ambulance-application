import { createContext, useContext, useState, useCallback } from 'react';
import { translate } from '../i18n/translations';

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem('lang') || 'en'; } catch { return 'en'; }
  });

  const changeLang = useCallback((next) => {
    setLang(next);
    try { localStorage.setItem('lang', next); } catch { /* storage unavailable */ }
  }, []);

  const t = useCallback((key) => translate(lang, key), [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang: changeLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
