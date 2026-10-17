import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Telefon arayüzünün giriş noktası (mobile.html). Masaüstü girişi
// (src/main.tsx → App.tsx) bundan bağımsızdır; React Flow buraya girmez.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main>Proje Metraj</main>
  </StrictMode>,
);
