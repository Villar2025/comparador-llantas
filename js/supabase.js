export const SUPABASE_URL = 'https://kxnhhttaqrsivgzlonec.supabase.co';

export const SUPABASE_KEY =
  'sb_publishable_ruJ2KcdpDnBUbeDUL7FWSg_qnt2zD5C';

export async function connect() {
  if (!globalThis.supabase) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');

      script.src = './vendor/supabase.js';
      script.onload = resolve;
      script.onerror = () => {
        reject(
          new Error(
            'No se encuentra vendor/supabase.js. Copia toda la carpeta del paquete.'
          )
        );
      };

      document.head.append(script);
    });
  }

  return globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (url, options = {}) =>
        fetch(url, {
          ...options,
          signal: options.signal || AbortSignal.timeout(25000),
        }),
    },
  });
}