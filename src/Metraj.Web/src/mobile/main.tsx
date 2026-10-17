import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MobileApp } from './MobileApp';
import { applyStoredTheme } from './shell/theme.ts';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/components.css';

// Telefon arayüzünün giriş noktası (mobile.html). Masaüstü girişi
// (src/main.tsx → App.tsx) bundan bağımsızdır; React Flow buraya girmez
// (tests/mobile-bundle.test.mjs bunu derleme çıktısında doğrular).
applyStoredTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MobileApp />
  </StrictMode>,
);
