import { setBaseUrl } from '@workspace/api-client-react';

/**
 * Configure the API client before any React queries run.
 *
 * Default: same-origin relative `/api/...` at the site root (Vite proxy locally,
 * Vercel rewrite in prod). When the UI is hosted under a path prefix such as
 * `/volume-bot/` on a shared marketing domain, root `/api` is still correct if
 * that domain proxies `/api/app/*` and `/api/bot/*` to this deployment.
 *
 * Optional: set `VITE_API_BASE_URL` at build time to an absolute API origin
 * (e.g. `https://<your-api>.vercel.app`) or a path prefix (e.g. `/volume-bot`)
 * when the UI and API are on different hosts/paths.
 * Never falls back to Replit or any other hardcoded remote.
 */
export function configureApiBaseUrl(): void {
  const raw = import.meta.env.VITE_API_BASE_URL;
  if (typeof raw !== 'string') {
    setBaseUrl(null);
    return;
  }

  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) {
    setBaseUrl(null);
    return;
  }

  if (/replit/i.test(trimmed)) {
    console.error(
      'VITE_API_BASE_URL points at a Replit host; ignoring. Use same-origin /api or your Vercel API URL.',
    );
    setBaseUrl(null);
    return;
  }

  setBaseUrl(trimmed);
}
