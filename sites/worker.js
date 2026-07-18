/**
 * Cloudflare Worker entry point used by OpenAI Sites.
 *
 * The application remains a static Vite build. Sites exposes dist/client
 * through the ASSETS binding while this worker provides an HTML fallback for
 * navigation requests.
 */
export default {
  async fetch(request, env) {
    const assetResponse = await env.ASSETS.fetch(request);

    if (assetResponse.status !== 404) {
      return assetResponse;
    }

    const acceptsHtml = request.headers.get('accept')?.includes('text/html');
    if (!acceptsHtml) {
      return assetResponse;
    }

    const indexUrl = new URL('/index.html', request.url);
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};
