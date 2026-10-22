# Dateos marketing site

One page in English and Hebrew (`#en` / `#he`; the switch also follows the browser language), with
real screenshots from `docs/screenshots`. No cookies, analytics or third-party scripts; fonts load
from Google Fonts (for an EU audience, consider hosting them yourself ⚖️).

```bash
node site/build.mjs                                   # writes site/dist (page + WebP screenshots)
SITE_URL=https://dateos.example.org node site/build.mjs   # also adds the social preview image tag
```

`site/dist/` is a static folder: upload it to any static host (GitHub Pages, Netlify, your own
Caddy). Edit the page in `site/src/page.html`; Hebrew texts are in the `he` object in its script.
