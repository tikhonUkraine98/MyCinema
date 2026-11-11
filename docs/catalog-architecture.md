# MyCinema: real architecture (November 2026)

## What is connected

1. **TMDB catalogue** (requires a personal API key): results from `/discover/tv`, posters, series names, ratings and season metadata. **All years and current releases are included by default.** The optional year filter is user-controlled.
2. **TMDB/JustWatch platform listings**: `/tv/{id}/watch/providers` reports streaming services by country. These are **not** download URLs or playback licenses.
3. **Internet Archive open video provider** (no TMDB key required for direct search): title search + metadata for specifically declared CC/PD rights, MP4/WebM file discovery and best-effort HTTP/video probes. Most commercial shows are not available through this connector.
4. **Local user-provided sources**: manually entered direct MP4/WebM URLs; native browser video player and optional browser streaming download. CORS, subscription auth and DRM can prevent this.
5. **Offline playback**: select local downloaded files; browser creates temporary object URLs.

## Catalogue modes

- **Усі серіали TMDB** (default): shows recent and historic shows without requiring a downloadable video file. On each card, **Шукати відкриті відео** performs a separate lookup for that show.
- **Лише з перевіреним відкритим файлом**: only shows items for which the limited Archive provider passed a media probe. Zero matches is possible.
- **Доступні на стримінгових платформах**: filters by platform provider information, not MP4 availability.

The absence of an Internet Archive match **does not mean a show does not exist** and does not demonstrate that it cannot be watched on a licensed platform.

## Verification

`node tests/verify.mjs` ensures UI controls, JS syntax and absence of forced pre-1980 filters.

`node tests/browser-smoke.mjs` uses a mocked TMDB response with **2025 and 2026** release dates and asserts both appear in the default catalogue. It also exercises simulated Archive licensing and download logic. Mocked tests do not establish that real third-party servers are reachable.

The default catalogue is tested with mocked 2025 and 2026 series, and no Archive lookup is required to render their cards. Real network availability must still be tested separately.
