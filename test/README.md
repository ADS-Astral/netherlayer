# Tests

Browser tests for `launch.html`. They drive the real page in Chromium through
Playwright, serving the repo's own files and caching every map tile and CDN
script to disk, so a run needs the network once and never again.

```
node test/flight.js          # one test
BUDGET=900 node test/flight.js
bash test/run.sh             # all of them, with timings
```

`CHROMIUM` and `PLAYWRIGHT_MODULE` override where those live. Everything the
tests write — the tile cache, the vendored three.js, the screenshots — lands
in `test/.cache/` and `test/*.png`, both ignored by git.

## What each one covers

| | |
|---|---|
| `flight.js` | solve, launch, every camera, the orbit drag, apogee, touchdown, the escape-velocity and never-leaves-the-rails cases |
| `console.js` | every station and dial, rails in 1 m steps, banks making farads, presets, the launch button |
| `dest.js` | the opening pad, and picking a terrestrial destination by name, by Enter, by clearing, and by tapping a marker on the globe |
| `order.js` | the station rail reads in the right order at four widths, and every key opens its own pane |
| `mobile.js` | portrait at five sizes: nothing overlaps, nothing spills sideways, closed and open and counting and flying |
| `missile.js` | the round is the missile model: fires, scrubs into flight, shoots it from behind and from the side |
| `rail.js` | the rail is three.js boxes: length, bore gap, rail height and elevation each visibly shape it |
| `impact.js` | whether the round lands on the terrain under it or on a flat sea level |
| `three-site.js` | the hangar and tank models load and the model layer goes up; takes screenshots of the site |
| `fallback-models.js` | with three.js and both models blocked, the site still stands, still solves, still fires |

## Two things to know before changing them

**They rasterise on the CPU.** Chromium runs with SwiftShader, so fill rate is
the dominant cost of every one of these — far more than anything the page
does. If a test gets slow, look at the viewport and the device scale factor
first. `mobile.js` was once rendering a 390×844 phone at `deviceScaleFactor: 2`,
which is 1.3 megapixels, more than the desktop test. Every assertion here reads
values — HUD numbers, geometry, classes — not pixels, so rendering fewer of
them costs nothing.

**Nothing may hang.** Each file has a wall-clock watchdog that prints what it
has, closes the browser and exits. A per-action timeout is *not* a substitute:
Playwright applies it to each call separately, so a 240 s action timeout across
fifteen steps is an hour of waiting, which is exactly the hole this dug itself
into once. Keep the per-action budget modest, keep the watchdog, and keep
screenshots non-fatal — they force a whole frame and are the slowest thing in
any of these runs.

A fresh checkout has an empty cache, so each file pulls MapLibre down before
navigating — fetching a megabyte while the page is already booting loses the
race and the loader never clears.

Typical times on the CPU rasteriser: `fallback` 60 s, `three-site` 125 s,
`dest` 140 s, `missile` 180 s, `rail` 210 s, `impact` 230 s, `order` 240 s,
`flight` 300 s, `console` 325 s, `mobile` 425 s.

`missile.js` is the odd one out: it is judged by eye, not by values, so it runs
at a larger viewport and hides the console before each shot. Everything else
should stay small.
