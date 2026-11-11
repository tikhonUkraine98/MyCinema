# PeerTube provider QA

This integration uses the public SepiaSearch federation search API and the origin server's native `GET /api/v1/videos/{uuid}` endpoint.

## Expected path

1. In MyCinema, press **PeerTube відео** and search a title.
2. For public long-form videos with a declared CC BY, CC BY-SA or public-domain license, review the source.
3. Press **Перевірити MP4 і додати**. The app must require an HTTPS source, a public non-live video, an explicit supported license, direct MP4/WebM (not HLS-only), basic HTTP accessibility and a loaded media frame after seeking.
4. On success, add the direct file to the MyCinema library with attributed source metadata. Browser file downloads require a separate user action.
5. Cross-origin errors, missing downloads, unknown copyright, short videos and non-video responses are rejected rather than represented as downloadable.

## Exclusions

This does **not** find subscription-only commercial series. A title match is not proof of content identity. An uploader-declared license is not proof of ownership. Do not bypass authentication or DRM.

## Automated checks

`node tests/verify.mjs` should validate syntax, wiring and license checks.
`node tests/browser-smoke.mjs` should test mocked SepiaSearch results, original-server video detail, HEAD verification, video metadata seek, attribution and library import.

These are mock tests; separately test genuine PeerTube hosts and browser CORS before claiming end-to-end live verification.
