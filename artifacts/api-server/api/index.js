// Vercel serverless entry. Bundle lives in ../dist (created by buildCommand).
// includeFiles in vercel.json forces dist/** into the function (dist is gitignored).
export { default } from "../dist/app.mjs";
