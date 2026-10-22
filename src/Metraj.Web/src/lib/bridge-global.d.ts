import type { MetrajBridgeLike } from './transport';

// Android kabuğu bu nesneyi yalnız https://appassets.androidplatform.net
// origin'ine ekler. Masaüstünde ve tarayıcıda tanımsızdır.
declare global {
  interface Window {
    MetrajBridge?: MetrajBridgeLike;
  }
}

export {};
