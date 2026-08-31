# The Supreme Cheeto

A 1997-style Windows desktop that tracks the national debt, Truth Social, approval
ratings and the price of eggs. Real sourced data, unserious presentation.

## Layout

```
public/            static site (this is what Netlify publishes)
  index.html       the desktop shell
  app.js           window manager + renderers
  logo.svg         mascot (also the favicon)
  og.png           link-preview card
netlify/
  functions/
    refresh.mjs      scheduled every 15 min — pulls every source, writes to Blobs
    refresh-now.mjs  same thing, HTTP-triggerable, for manual pulls
    data.mjs         public read endpoint the page polls
  lib/sources.mjs    all the scraping/fetching logic (shared by the above)
netlify.toml       publish dir, functions dir, headers
```

## Deploying

1. Push to GitHub.
2. In Netlify: **Site configuration → Build & deploy → Continuous deployment →
   Link repository**, pick this repo, branch `main`.
3. Leave build settings blank — `netlify.toml` sets everything.
4. After the first deploy, hit `https://<your-site>/.netlify/functions/refresh-now`
   once so the site has data immediately instead of waiting for the first cron fire.

## How the data works

The page never scrapes anything itself. A scheduled function pulls every source every
15 minutes and stores one JSON blob; the page reads that blob and re-checks every 5
minutes.

Three rules the function follows, because scraping other people's HTML is brittle:

- Every source is fetched in isolation — one failure never takes down the rest.
- On failure the **previous** value is kept, never blanked and never guessed.
- Every field carries its own `ok` + `at` stamp, and the page renders that as a
  freshness chip. Nothing is ever shown as current when it isn't.

If the whole endpoint is unreachable, the page falls back to a snapshot baked into
`SEED` in `app.js` and labels every figure as coming from the snapshot.

### Sources

| Field | Source | Type |
|---|---|---|
| National debt | Treasury "Debt to the Penny" | JSON API — reliable |
| Truth Social posts | Truth Social API, falling back to trumpstruth.org | API, then HTML |
| Approval | FiftyPlusOne | HTML |
| Gas | AAA | HTML |
| Executive orders | Federal Register | JSON API — reliable |
| Golf days | donaldtrump.golf | HTML |
| CPI / eggs / tariff | BLS, Penn Wharton | monthly, set by hand in `sources.mjs` |

The HTML ones are the fragile half — if a site restyles, that field goes stale and
gets flagged rather than going wrong. Fix the extractor in `netlify/lib/sources.mjs`.

**Truth Social specifically:** it sits behind Cloudflare and rate-limits scrapers.
It may work from Netlify's IPs or it may not. Check what `refresh-now` returns —
`postsVia` tells you which source actually answered.

## Editorial rules

Post text is reproduced verbatim. Nothing is paraphrased, reconstructed, or invented,
and no quote is ever attributed to anyone who didn't say it. The Magic 8-Ball is
labeled as random and is not a prediction. Every number links to its source.
The jokes are in the framing, not the data.
