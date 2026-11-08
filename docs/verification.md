# Acceptance checklist · MyCinema

## Safe, repeatable local checks

1. Windows: extract ZIP and double-click `start.cmd`; `index.html` should open without a build step.
2. No TMDB key: click **Пошук відкритих файлів**, use the title search and open-archive browsing controls.
3. Check that an Archive item with no explicit recognized CC/CC0/PD license is **not** offered for automatic downloading.
4. With a known openly licensed source: check file existence, preview duration, add it to the local library, and verify **rights attribution** in the player and exported JSON.
5. In local library: **Показувати лише серіали з попередньо доступним відео** shows only media that passed an initial playback probe.
6. Open a source and use **Завантажити серію**. Test a full file, repeat the same action to check skip, and interrupt midway before retrying to exercise Range resume.
7. With TMDB credentials (optional): browse **Каталог серіалів** in verified-download mode and in **Платформи** mode. Confirm the difference is explicit.
8. Load `index.html` without network access: local library should remain usable for already downloaded files, but external API lookups will fail gracefully.
9. Verify Chrome/Edge **File System Access API**. Some browsers lack streaming download support; such cases must show an error, not pretend to save.

## Automated checks

`node tests/verify.mjs` validates script syntax, DOM hooks and attribution-related modules.

`node tests/browser-smoke.mjs` uses stubbed network responses and mock browser/file APIs to exercise startup, TMDB navigation, open-source searching, attribution persistence, media verification and file writing.

## Scope and limitations

This application **does not** provide unauthorized copies of subscription-only episodes. TMDB/JustWatch reports streaming-platform listings, not playable downloads. The open-license Archive connector searches public metadata and verifies candidate media on a best-effort basis; incorrect third-party licensing claims are possible and a successful probe cannot guarantee an entire file is valid. Streaming and Archive services may rate-limit or change APIs.

Performance optimizations: no more than three candidate-provider lookups in parallel, bounded Archive metadata lookup, source verification cache, and local video probes of at most two concurrent media streams.
