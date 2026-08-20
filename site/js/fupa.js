const Fupa = (() => {
  const API_BASE = 'https://api.fupa.net/';
  const GALLERY_STREAM_TYPE = 'galerie';

  class FupaError extends Error {
    /**
     * @param {string} message Message meant for display in the interface.
     * @param {string} code Machine readable reason, used to pick a hint.
     */
    constructor(message, code) {
      super(message);
      this.name = 'FupaError';
      this.code = code || 'unknown';
    }
  }

  /**
   * Determines which fupa.net resource a pasted string points at. Accepts full
   * match and photo URLs as well as a bare match slug.
   *
   * @param {string} input Text entered by the user.
   * @returns {{kind: string, slug: string}|{kind: string, id: string}|null}
   */
  function parseInput(input) {
    const cleaned = String(input || '').trim().split('#')[0].split('?')[0];
    if (!cleaned) {
      return null;
    }

    const matchUrl = cleaned.match(/fupa\.net\/match\/([a-z0-9-]+)\/?$/i);
    if (matchUrl) {
      return { kind: 'match', slug: matchUrl[1] };
    }

    const photosUrl = cleaned.match(/fupa\.net\/photos\/[a-z0-9-]*?(\d+)\/?$/i);
    if (photosUrl) {
      return { kind: 'gallery', id: photosUrl[1] };
    }

    if (/^[a-z0-9-]+$/i.test(cleaned) && /\d/.test(cleaned)) {
      return { kind: 'match', slug: cleaned };
    }

    return null;
  }

  /**
   * Fetches a fupa API path through the configured CORS proxies, trying each
   * entry until one delivers a usable response.
   *
   * @param {string} path API path relative to the fupa API root.
   * @returns {Promise<Object|Array>} Parsed JSON payload.
   */
  async function request(path) {
    const target = API_BASE + path;
    const proxies = (CONFIG.corsProxies || []).filter(
      (proxy) => proxy && !proxy.includes('DEIN-SUBDOMAIN'),
    );

    if (!proxies.length) {
      throw new FupaError('Es ist kein CORS-Proxy konfiguriert.', 'no-proxy');
    }

    let lastError = null;
    for (const proxy of proxies) {
      const url = proxy.includes('{url}')
        ? proxy.replace('{url}', encodeURIComponent(target))
        : proxy + encodeURIComponent(target);

      let response;
      try {
        response = await fetch(url, { headers: { Accept: 'application/json' } });
      } catch (error) {
        lastError = new FupaError('Der Proxy ist nicht erreichbar.', 'proxy-unreachable');
        continue;
      }

      if (response.status === 404) {
        throw new FupaError('Diese Seite gibt es auf fupa.net nicht.', 'not-found');
      }

      if (!response.ok) {
        lastError = new FupaError(
          `Der Proxy hat mit Status ${response.status} geantwortet.`,
          'proxy-error',
        );
        continue;
      }

      try {
        return await response.json();
      } catch (error) {
        lastError = new FupaError('Die Antwort war kein gültiges JSON.', 'bad-response');
      }
    }

    throw lastError;
  }

  /**
   * Loads the core data of a match, including the display names of both teams.
   *
   * @param {string} slug Match slug taken from the fupa.net URL.
   * @returns {Promise<Object>} Match payload.
   */
  function loadMatch(slug) {
    return request(`v1/matches/${encodeURIComponent(slug)}`);
  }

  /**
   * Loads the activity stream of a match, which is where photo galleries are
   * announced.
   *
   * @param {string} slug Match slug taken from the fupa.net URL.
   * @returns {Promise<Array>} Stream items.
   */
  function loadStream(slug) {
    return request(`v2/matches/${encodeURIComponent(slug)}/stream`);
  }

  /**
   * Loads a single gallery with its list of photos.
   *
   * @param {string|number} id Numeric gallery id.
   * @returns {Promise<Object>} Gallery payload.
   */
  function loadGallery(id) {
    return request(`v1/galleries/${encodeURIComponent(id)}`);
  }

  /**
   * Picks the gallery entries out of a match stream, ignoring goals, news and
   * every other item type.
   *
   * @param {Array} stream Stream items as returned by the API.
   * @returns {Array<Object>} Gallery stubs in stream order.
   */
  function extractGalleries(stream) {
    if (!Array.isArray(stream)) {
      return [];
    }
    return stream
      .filter((item) => item && item.type === GALLERY_STREAM_TYPE && item.entity)
      .map((item) => item.entity);
  }

  /**
   * Builds the download URLs of all photos in a gallery at the configured
   * variant, skipping entries without a usable image path.
   *
   * @param {Object} gallery Gallery payload.
   * @returns {Array<string>} Absolute image URLs.
   */
  function photoUrls(gallery) {
    const items = (gallery && gallery.items) || [];
    return items
      .map((item) => item && item.image && item.image.path)
      .filter((path) => typeof path === 'string' && path.startsWith('https://image.fupa.net/'))
      .map((path) => `${path}${CONFIG.imageVariant}`);
  }

  /**
   * Reads the home and away team names of a match, falling back to the names
   * nested inside a gallery payload.
   *
   * @param {Object} match Match or gallery match payload.
   * @returns {{home: string, away: string}} Team display names.
   */
  function teamNames(match) {
    const fallback = (team) => (team && team.name && team.name.full) || '';
    return {
      home: (match && match.homeTeamName) || fallback(match && match.homeTeam) || 'Heim',
      away: (match && match.awayTeamName) || fallback(match && match.awayTeam) || 'Gast',
    };
  }

  return {
    FupaError,
    parseInput,
    loadMatch,
    loadStream,
    loadGallery,
    extractGalleries,
    photoUrls,
    teamNames,
  };
})();
