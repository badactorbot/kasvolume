// Same-origin /api on the frontend Vercel project.
// Loads api-server dist via includeFiles (gitignored dist must be force-included).
export { default } from "../../api-server/dist/app.mjs";
