const ALLOWED_ORIGINS = [
  'https://janvogt06.github.io',
];

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const ALLOWED_TARGET_PREFIX = 'https://api.fupa.net/';

const CACHE_SECONDS = 300;

/**
 * Decides whether a request origin may use this proxy.
 *
 * @param {string|null} origin Value of the request's Origin header.
 * @returns {boolean} True if the origin is on the allow list.
 */
function isAllowedOrigin(origin) {
  if (!origin) {
    return false;
  }
  return ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin);
}

/**
 * Builds the CORS headers for a permitted origin.
 *
 * @param {string} origin Origin to grant access to.
 * @returns {Object<string, string>} Header map.
 */
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/**
 * Produces a JSON error response carrying the CORS headers.
 *
 * @param {number} status HTTP status code.
 * @param {string} message Human readable reason.
 * @param {string} origin Origin to echo back, may be empty.
 * @returns {Response} Error response.
 */
function errorResponse(status, message, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? corsHeaders(origin) : {}),
    },
  });
}

export default {
  /**
   * Forwards read-only requests to the fupa.net API and adds the CORS headers
   * that the API itself only grants to www.fupa.net.
   *
   * @param {Request} request Incoming request.
   * @returns {Promise<Response>} Proxied response.
   */
  async fetch(request) {
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      if (!isAllowedOrigin(origin)) {
        return errorResponse(403, 'Origin not allowed', '');
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (!isAllowedOrigin(origin)) {
      return errorResponse(403, 'Origin not allowed', '');
    }

    if (request.method !== 'GET') {
      return errorResponse(405, 'Only GET is supported', origin);
    }

    const target = new URL(request.url).searchParams.get('url');
    if (!target) {
      return errorResponse(400, 'Missing url parameter', origin);
    }

    if (!target.startsWith(ALLOWED_TARGET_PREFIX)) {
      return errorResponse(403, 'Only the fupa.net API may be proxied', origin);
    }

    const upstream = await fetch(target, {
      headers: {
        Accept: 'application/json',
        Origin: 'https://www.fupa.net',
        Referer: 'https://www.fupa.net/',
      },
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
    });

    const headers = new Headers(corsHeaders(origin));
    headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
    headers.set('Cache-Control', `public, max-age=${CACHE_SECONDS}`);

    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
