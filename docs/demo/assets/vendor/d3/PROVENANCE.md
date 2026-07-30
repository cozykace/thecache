# Vendored D3 — provenance

These files are **pinned copies**, committed on purpose. Nothing here is fetched from a CDN at
runtime: the page's Content-Security-Policy is `script-src 'self'`, and a hijacked CDN release
could otherwise ship code that runs next to a decrypted vault (security eval 2026-07-21, T4).

| File | Package | Version | License | Source URL |
|---|---|---|---|---|
| `d3.min.js` | [d3](https://d3js.org) | **7.9.0** | ISC | `https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js` |
| `d3-sankey.min.js` | [d3-sankey](https://github.com/d3/d3-sankey) | **0.12.3** | BSD-3-Clause | `https://cdn.jsdelivr.net/npm/d3-sankey@0.12.3/dist/d3-sankey.min.js` |

SHA-256 of the files as committed (`shasum -a 256 assets/vendor/d3/*.js`):

```
8286db5d6aa049cc6e8a546708943b79dfb4daaefb0ccf42af674ec0ee4c86be  d3-sankey.min.js
f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539  d3.min.js
```

`d3-sankey.min.js` is a UMD build that both reads from and extends the global `d3`, so **load
order matters**: `d3.min.js` first, `d3-sankey.min.js` second. `d3Load()` in `app.js` enforces it.

Neither file loads at boot. `d3Load()` injects them on the first Visualizer open only, and the
Visualizer falls back to its plain-SVG scene if either script fails.

Upgrading, and the do/don't list for adapting Observable examples: see
`Working Docs/WIKI/30-infrastructure/d3-sop.md`.
