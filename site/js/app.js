(() => {
  const PREVIEW_VARIANT = '300x200.jpeg';
  const PREVIEW_LIMIT = 12;
  const RETRY_DELAY_MS = 400;

  const form = document.getElementById('search-form');
  const input = document.getElementById('link-input');
  const searchButton = document.getElementById('search-button');
  const status = document.getElementById('status');
  const result = document.getElementById('result');
  const resultTitle = document.getElementById('result-title');
  const resultMeta = document.getElementById('result-meta');
  const preview = document.getElementById('preview');
  const downloadButton = document.getElementById('download-button');
  const progress = document.getElementById('progress');
  const progressBar = document.getElementById('progress-bar');
  const progressLabel = document.getElementById('progress-label');

  const HINTS = {
    'proxy-unreachable':
      'Läuft der Container? Starte ihn mit <code>docker compose up -d</code> und '
      + 'öffne die Seite über seinen Port, nicht als lokale Datei.',
    'api-error':
      'fupa.net hat einen Fehler gemeldet. Versuche es in ein paar Minuten noch einmal.',
  };

  let current = null;

  /**
   * Replaces characters that are not allowed in file names on common operating
   * systems and collapses the remaining whitespace.
   *
   * @param {string} value Raw name.
   * @returns {string} Name that is safe to use inside the archive.
   */
  function sanitize(value) {
    return String(value)
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .trim() || 'Unbenannt';
  }

  /**
   * Formats a byte count as a human readable size.
   *
   * @param {number} bytes Size in bytes.
   * @returns {string} Localised size with unit.
   */
  function formatSize(bytes) {
    const megabytes = bytes / (1024 * 1024);
    return `${megabytes.toFixed(1).replace('.', ',')} MB`;
  }

  /**
   * Writes a message into the status line.
   *
   * @param {string} message Text to show, may be empty to clear the line.
   * @param {string} [code] Error code that selects an additional hint.
   */
  function setStatus(message, code) {
    status.textContent = message || '';
    status.classList.toggle('is-error', Boolean(code));
    if (message && code && HINTS[code]) {
      const hint = document.createElement('span');
      hint.className = 'status-hint';
      hint.innerHTML = HINTS[code];
      status.appendChild(hint);
    }
  }

  /**
   * Hides the result panel and clears everything it holds.
   */
  function resetResult() {
    current = null;
    result.hidden = true;
    preview.innerHTML = '';
    progress.hidden = true;
    progressBar.style.width = '0';
    progressLabel.textContent = '';
    downloadButton.disabled = false;
  }

  /**
   * Renders up to a fixed number of thumbnails for the found photos.
   *
   * @param {Array<string>} paths Image base paths.
   */
  function renderPreview(paths) {
    preview.innerHTML = '';
    paths.slice(0, PREVIEW_LIMIT).forEach((path, index) => {
      const image = document.createElement('img');
      image.src = Fupa.imageUrl(path, PREVIEW_VARIANT);
      image.alt = `Vorschau ${index + 1}`;
      image.loading = 'lazy';
      preview.appendChild(image);
    });
  }

  /**
   * Loads the team names and every gallery that belongs to the pasted link.
   *
   * @param {{kind: string, slug?: string, id?: string}} parsed Parsed input.
   * @returns {Promise<{names: Object, galleries: Array<Object>}>} Collected data.
   */
  async function collect(parsed) {
    if (parsed.kind === 'gallery') {
      const gallery = await Fupa.loadGallery(parsed.id);
      const slug = gallery.match && gallery.match.slug;
      const match = slug ? await Fupa.loadMatch(slug) : gallery.match;
      return { names: Fupa.teamNames(match), galleries: [gallery] };
    }

    const [match, stream] = await Promise.all([
      Fupa.loadMatch(parsed.slug),
      Fupa.loadStream(parsed.slug),
    ]);

    const stubs = Fupa.extractGalleries(stream);
    const galleries = [];
    for (const stub of stubs) {
      galleries.push(await Fupa.loadGallery(stub.id));
    }

    return { names: Fupa.teamNames(match), galleries };
  }

  /**
   * Fetches one image and returns its raw bytes, retrying once on failure.
   *
   * @param {string} url Absolute image URL.
   * @returns {Promise<Uint8Array>} Image data.
   */
  async function fetchImage(url) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Status ${response.status}`);
        }
        return new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        if (attempt === 1) {
          throw error;
        }
        await new Promise((resolve) => { setTimeout(resolve, RETRY_DELAY_MS); });
      }
    }
    throw new Error('unreachable');
  }

  /**
   * Downloads all images with a bounded number of parallel requests while
   * keeping the original order.
   *
   * @param {Array<string>} urls Image URLs to fetch.
   * @param {function(number): void} onProgress Called with the finished count.
   * @returns {Promise<Array<Uint8Array>>} Image data in input order.
   */
  async function fetchAll(urls, onProgress) {
    const images = new Array(urls.length);
    let next = 0;
    let finished = 0;

    const lanes = Array.from(
      { length: Math.min(CONFIG.concurrency, urls.length) },
      async () => {
        while (next < urls.length) {
          const index = next;
          next += 1;
          images[index] = await fetchImage(urls[index]);
          finished += 1;
          onProgress(finished);
        }
      },
    );

    await Promise.all(lanes);
    return images;
  }

  /**
   * Hands a finished archive to the browser as a download.
   *
   * @param {Blob} blob Archive contents.
   * @param {string} fileName Name to suggest.
   */
  function saveBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  /**
   * Runs the search for a pasted link and fills the result panel.
   *
   * @param {Event} event Submit event of the search form.
   */
  async function onSearch(event) {
    event.preventDefault();
    resetResult();

    const parsed = Fupa.parseInput(input.value);
    if (!parsed) {
      setStatus('Das sieht nicht nach einem fupa.net-Spiellink aus.', 'bad-input');
      return;
    }

    searchButton.disabled = true;
    setStatus('Suche Fotos …');

    try {
      const { names, galleries } = await collect(parsed);
      const paths = [...new Set(galleries.flatMap((gallery) => Fupa.photoPaths(gallery)))];

      if (!paths.length) {
        setStatus(`Für ${names.home} – ${names.away} gibt es auf fupa.net keine Fotos.`);
        return;
      }

      const folder = sanitize(`${names.home} - ${names.away}`);
      current = { folder, paths };

      resultTitle.textContent = `${names.home} – ${names.away}`;
      resultMeta.textContent = galleries.length > 1
        ? `${paths.length} Fotos aus ${galleries.length} Galerien`
        : `${paths.length} Fotos`;
      renderPreview(paths);
      result.hidden = false;
      setStatus('');
    } catch (error) {
      const known = error instanceof Fupa.FupaError;
      setStatus(
        known ? error.message : 'Beim Laden ist ein Fehler aufgetreten.',
        known ? error.code : 'unknown',
      );
    } finally {
      searchButton.disabled = false;
    }
  }

  /**
   * Downloads every found photo and offers the resulting archive.
   */
  async function onDownload() {
    if (!current) {
      return;
    }

    const { folder, paths } = current;
    const urls = paths.map((path) => Fupa.imageUrl(path, CONFIG.imageVariant));

    downloadButton.disabled = true;
    progress.hidden = false;
    progressBar.style.width = '0';
    progressLabel.textContent = `0 von ${urls.length} Fotos geladen`;

    try {
      const images = await fetchAll(urls, (finished) => {
        progressBar.style.width = `${(finished / urls.length) * 100}%`;
        progressLabel.textContent = `${finished} von ${urls.length} Fotos geladen`;
      });

      const entries = images.map((data, index) => ({
        name: `${folder}/${folder} - ${String(index + 1).padStart(3, '0')}.${CONFIG.fileExtension}`,
        data,
      }));

      progressLabel.textContent = 'Packe ZIP …';
      const archive = Zip.create(entries);
      saveBlob(archive, `${folder}.zip`);
      progressLabel.textContent = `Fertig – ${entries.length} Fotos, ${formatSize(archive.size)}`;
    } catch (error) {
      setStatus('Mindestens ein Foto konnte nicht geladen werden.', 'download-failed');
      progressLabel.textContent = '';
    } finally {
      downloadButton.disabled = false;
    }
  }

  form.addEventListener('submit', onSearch);
  downloadButton.addEventListener('click', onDownload);
  input.addEventListener('input', resetResult);
})();
