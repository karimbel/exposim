import './style.css';
import { buildApp, buildFooter, type Language } from './ui';

const app = document.getElementById('app');
if (!app) throw new Error('Élément #app introuvable');

const savedLanguage = localStorage.getItem('exposim-language');
const language: Language = savedLanguage === 'en' ? 'en' : 'fr';
const savedTheme = localStorage.getItem('exposim-theme');
document.documentElement.dataset.theme = savedTheme === 'light' ? 'light' : 'dark';
document.documentElement.lang = language;

buildApp(app, language);
buildFooter(app, language);
