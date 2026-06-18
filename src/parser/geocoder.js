/**
 * geocoder.js
 * Nominatim geocoder with LRU caching and rate limiting.
 *
 * Converts place names to coordinates using the OpenStreetMap Nominatim API.
 * Respects Nominatim's usage policy (max 1 request/second).
 *
 * @module parser/geocoder
 */

/**
 * @typedef {object} GeocodeResult
 * @property {number} lat
 * @property {number} lon
 * @property {string} displayName
 */

export class Geocoder {
  /**
   * @param {object} options
   * @param {number}  [options.cacheSize=500]     - Maximum entries in LRU cache
   * @param {number}  [options.rateLimitMs=1100]   - Min ms between Nominatim requests
   * @param {string}  [options.baseUrl]            - Override Nominatim endpoint
   * @param {boolean} [options.persistCache=true]  - Persist cache to localStorage
   */
  constructor(options = {}) {
    this.cacheSize = options.cacheSize || 500;
    this.rateLimitMs = options.rateLimitMs || 1100; // Nominatim requires 1 req/sec
    this.baseUrl = options.baseUrl || 'https://nominatim.openstreetmap.org/search';
    this.persistCache = options.persistCache !== false;

    /** @type {Map<string, GeocodeResult>} LRU cache (Map preserves insertion order) */
    this._cache = new Map();
    this._lastRequestTime = 0;
    this._requestQueue = [];
    this._processing = false;

    // Load persisted cache
    if (this.persistCache) {
      this._loadCache();
    }
  }

  /**
   * Geocode a place name to coordinates.
   *
   * @param {string} placeName - The place name to geocode
   * @returns {Promise<GeocodeResult|null>} - { lat, lon, displayName } or null
   */
  async geocode(placeName) {
    if (!placeName || typeof placeName !== 'string') return null;

    const key = placeName.toLowerCase().trim();
    if (!key) return null;

    // Check cache first
    const cached = this._getFromCache(key);
    if (cached) return cached;

    // Queue the request (rate-limited)
    try {
      const result = await this._enqueueRequest(key);
      if (result) {
        this._addToCache(key, result);
      }
      return result;
    } catch (err) {
      console.warn('[Geocoder] Request failed:', err.message);
      return null;
    }
  }

  /**
   * Clear the geocode cache.
   */
  clearCache() {
    this._cache.clear();
    if (this.persistCache && typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem('voicegis_geocache');
      } catch (_) { /* ignore */ }
    }
  }

  /**
   * Get the current cache size.
   * @returns {number}
   */
  get cacheCount() {
    return this._cache.size;
  }

  // ---------------------------------------------------------------------------
  // Internal: rate-limited request queue
  // ---------------------------------------------------------------------------

  /**
   * Enqueue a geocode request and wait for it to be processed.
   * Ensures we respect Nominatim's 1 request/second rate limit.
   * @param {string} key - Lowercased place name
   * @returns {Promise<GeocodeResult|null>}
   */
  _enqueueRequest(key) {
    return new Promise((resolve, reject) => {
      this._requestQueue.push({ key, resolve, reject });
      this._processQueue();
    });
  }

  async _processQueue() {
    if (this._processing || this._requestQueue.length === 0) return;
    this._processing = true;

    while (this._requestQueue.length > 0) {
      const { key, resolve, reject } = this._requestQueue.shift();

      // Check cache again (may have been populated by a duplicate request)
      const cached = this._getFromCache(key);
      if (cached) {
        resolve(cached);
        continue;
      }

      // Rate limit: wait if too soon since last request
      const elapsed = Date.now() - this._lastRequestTime;
      if (elapsed < this.rateLimitMs) {
        await this._sleep(this.rateLimitMs - elapsed);
      }

      try {
        const result = await this._fetchGeocode(key);
        this._lastRequestTime = Date.now();
        resolve(result);
      } catch (err) {
        reject(err);
      }
    }

    this._processing = false;
  }

  /**
   * Fetch geocode result from Nominatim.
   * @param {string} query
   * @returns {Promise<GeocodeResult|null>}
   */
  async _fetchGeocode(query) {
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      limit: '1',
      addressdetails: '0',
    });

    const url = `${this.baseUrl}?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'VoiceGIS/2.0 (https://github.com/SanishKumar/Voice_map)',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Nominatim returned ${response.status}`);
    }

    const data = await response.json();

    if (!data || data.length === 0) return null;

    const top = data[0];
    return {
      lat: parseFloat(top.lat),
      lon: parseFloat(top.lon),
      displayName: top.display_name || query,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal: LRU cache
  // ---------------------------------------------------------------------------

  _getFromCache(key) {
    if (this._cache.has(key)) {
      // Move to end (most recently used)
      const value = this._cache.get(key);
      this._cache.delete(key);
      this._cache.set(key, value);
      return value;
    }
    return null;
  }

  _addToCache(key, value) {
    // Evict oldest if at capacity
    if (this._cache.size >= this.cacheSize) {
      const oldest = this._cache.keys().next().value;
      this._cache.delete(oldest);
    }
    this._cache.set(key, value);

    // Persist
    if (this.persistCache) {
      this._saveCache();
    }
  }

  _saveCache() {
    if (typeof localStorage === 'undefined') return;
    try {
      const entries = Array.from(this._cache.entries()).slice(-this.cacheSize);
      localStorage.setItem('voicegis_geocache', JSON.stringify(entries));
    } catch (_) {
      // localStorage full or unavailable — silently ignore
    }
  }

  _loadCache() {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem('voicegis_geocache');
      if (raw) {
        const entries = JSON.parse(raw);
        for (const [key, value] of entries) {
          this._cache.set(key, value);
        }
      }
    } catch (_) {
      // Corrupt cache — silently ignore
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
