// UI translation (English source strings -> Chinese). Item names come from the dataset (names_i18n).
import { ZH } from './i18n-zh';
let lang: 'en' | 'zh' = 'en';
export const setUiLang = (l: 'en' | 'zh') => { lang = l; };
export const uiLang = () => lang;
export function t(s: string): string { return lang === 'zh' ? ZH[s] ?? s : s; }
