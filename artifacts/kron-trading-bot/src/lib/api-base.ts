import { setBaseUrl } from '@workspace/api-client-react';

/**
 * Configure the API client before any React queries run.
 *
 * Default: same-origin relative `/api/...` (Vite proxy locally, Vercel rewrite in prod).
 * Optional: set `VITE_API_BASE_URL` at build time to an absolute API origin
 * (e.g. `https://<your-api>.vercel.app`) when the UI and API are on different hosts.
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
