import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

// İki ayrı giriş: masaüstü (index.html, React Flow tuvali) ve telefon
// (mobile.html, React Flow'suz dokunmatik arayüz). Masaüstü kabuğu uzantısız
// her yolu index.html'e düşürür; mobile.html uzantılı olduğu için dosya olarak
// sunulur, yani C# tarafında ek bir eşleme gerekmez.
const entries = {
  index: fileURLToPath(new URL('./index.html', import.meta.url)),
  mobile: fileURLToPath(new URL('./mobile.html', import.meta.url)),
};

// `vite dev` / `vite preview` için yerel API. Masaüstü uygulaması her açılışta
// başka bir loopback portu seçtiği için adres sabit yazılamaz:
//   METRAJ_API_URL=http://127.0.0.1:54321 npm run dev
// Değişken yoksa vekil kurulmaz (önceki davranış).
const apiTarget = process.env.METRAJ_API_URL?.trim();
const proxy: Record<string, ProxyOptions> | undefined = apiTarget
  ? { '/api': { target: apiTarget, changeOrigin: true } }
  : undefined;

// Telefon sayfası bir WebView içinde, yalnız kendi paketinden yüklenir. Bu
// ilke yanlışlıkla eklenecek bir ağ isteğini veya satır içi betiği tarayıcı
// düzeyinde durdurur. Yalnız derlemede eklenir: geliştirme sunucusunun React
// yenileme önsözü satır içi betiktir ve bu ilkeyle çalışmaz.
const MOBILE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function mobileContentSecurityPolicy(): Plugin {
  return {
    name: 'metraj-mobile-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        if (!context.filename.replace(/\\/g, '/').endsWith('/mobile.html')) return html;
        // Karakter kümesi bildirimi ilk sırada kalır; ilke hemen ardından,
        // bütün betik ve stil bağlantılarından önce gelir.
        return html.replace(
          /<meta charset="UTF-8" \/>/i,
          (charset) => `${charset}\n    <meta http-equiv="Content-Security-Policy" content="${MOBILE_CSP}" />`,
        );
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), mobileContentSecurityPolicy()],
  server: { proxy },
  preview: { proxy },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      input: entries,
    },
  },
});
