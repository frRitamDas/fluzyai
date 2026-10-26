// Vercel serverless function: the whole Fluzy AI server (dashboard API, /v1
// proxy, Anthropic/Gemini/Ollama wire surfaces, MCP) behind one handler.
//
// The implementation lives in the server workspace so it shares every route,
// middleware and test with the self-hosted binary:
//   server/src/serverless.ts → server/dist/serverless.js → (esbuild) server/dist/serverless-bundle.mjs
//
// Routing: vercel.json rewrites every API/proxy path here with the original
// path in `__fluzy_path`, which the handler restores before Express routes the
// request. Static dashboard files are served from the CDN (outputDirectory),
// not from this function.
import handler from '../server/dist/serverless-bundle.mjs';

export const config = { maxDuration: 60 };

export default handler;
