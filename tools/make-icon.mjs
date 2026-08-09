/**
 * Draws WorldTrace's globe icon, with no image library.
 *
 * Run it as `node tools/make-icon.mjs assets` to regenerate every size.
 * Nothing else depends on it; the PNGs it writes are what ship.
 *
 * The globe is a graticule rather than a map of continents. At 48dp painted
 * coastlines turn to mush, and inventing coastlines for an app whose whole
 * point is real geography felt wrong. A latitude/longitude grid says "Earth"
 * unambiguously, and it happens to be what this app does to the planet: cut it
 * into tiles.
 *
 * An earlier version lit one patch of the grid to stand for cleared fog. It
 * was dropped: at icon size a lit cap reads as a moon phase, not as
 * exploration. The icon does not need to explain the app.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

// ---------------------------------------------------------------- PNG writing

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** `pixels` is RGBA, 4 bytes per pixel, row-major. */
function writePng(path, width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  // One filter byte per scanline. Filter 0 (none) keeps this simple; the
  // images are small and deflate handles the rest.
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const from = y * width * 4;
    const to = y * (1 + width * 4);
    raw[to] = 0;
    pixels.copy(raw, to + 1, from, from + width * 4);
  }

  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

// ------------------------------------------------------------------- drawing

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => a + (b - a) * t;
const mixColour = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

// The app's palette, so the icon and the screens are the same object.
const SPACE = [7, 11, 22]; // theme.background
const SEA_DARK = [11, 34, 74];
const SEA_LIGHT = [34, 90, 172];
const ACCENT = [91, 156, 255]; // theme.accent

const DEG = Math.PI / 180;

/** Tilt, so the globe reads as a globe rather than a target. */
const TILT = 22 * DEG;

const GRID_SPACING = 30 * DEG;

/**
 * How much of each canvas the globe fills, and how heavy its lines are.
 *
 * All in one place because they are the only knobs worth turning, and because
 * a fraction that differs between the launcher icon and the adaptive layers is
 * a globe that changes size depending on which launcher you use.
 *
 * The adaptive fractions are of the full 108dp canvas, of which only the middle
 * 72dp (66%) is guaranteed visible — so 0.48 leaves comfortable room inside the
 * mask rather than crowding its edge.
 */
const FILL = {
  square: 0.68, // legacy launcher icon and icon.png
  adaptive: 0.48, // adaptive foreground and monochrome
  splash: 0.58,
  favicon: 0.72,
};

/** Line weight as a fraction of the globe's diameter, with a floor for tiny sizes. */
const LINE = { ratio: 1 / 52, minimum: 1.7 };

/** Sphere geometry at a point, or null outside the disc. */
function geometry(x, y, cx, cy, radius) {
  const nx = (x - cx) / radius;
  const ny = (y - cy) / radius;
  const r2 = nx * nx + ny * ny;
  if (r2 >= 1) return null;

  const nz = Math.sqrt(1 - r2);

  // Screen y grows downward, latitude grows upward. Without this flip the
  // globe comes out upside down — the meridians converge at the bottom, which
  // looks plausible until you notice it is the north pole down there.
  const up = -ny;

  // Tilt about the x axis so the north pole leans toward the viewer.
  const wy = up * Math.cos(TILT) + nz * Math.sin(TILT);
  const wz = -up * Math.sin(TILT) + nz * Math.cos(TILT);

  return { nx, ny, nz, lat: Math.asin(clamp(wy, -1, 1)), lon: Math.atan2(nx, wz) };
}

/** Distance to the nearest multiple of the grid spacing, in radians. */
function toGrid(angle) {
  const half = GRID_SPACING / 2;
  return Math.abs((((angle % GRID_SPACING) + GRID_SPACING + half) % GRID_SPACING) - half);
}

/**
 * Shade one sample of the sphere. Returns [r, g, b, a], a = 0 off the disc.
 *
 * Line widths are measured in *pixels*, by dividing each angle's distance to
 * its grid line by how fast that angle changes per pixel right here. Guessing
 * the width instead — the obvious approach — gives lines that are fat and soft
 * near the centre and smeared to nothing at the limb.
 */
/** How strongly a point sits on a graticule line, 0 to 1. */
function gridAt(here, x, y, cx, cy, radius, lineWidth) {
  const { lat, lon } = here;

  // Numerical screen-space derivative, the same trick as fwidth() in a shader.
  const step = 0.5;
  const dx = geometry(x + step, y, cx, cy, radius);
  const dy = geometry(x, y + step, cx, cy, radius);
  if (!dx || !dy) return 0;

  const dLat = Math.max(Math.abs(dx.lat - lat), Math.abs(dy.lat - lat)) / step;
  // Longitude wraps at ±π; a step across the seam is not a real change.
  const wrap = (a) => Math.abs(((a - lon + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  const dLon = Math.max(wrap(dx.lon), wrap(dy.lon)) / step;

  const latPixels = dLat > 1e-9 ? toGrid(lat) / dLat : Infinity;
  const lonPixels = dLon > 1e-9 ? toGrid(lon) / dLon : Infinity;

  return Math.max(
    1 - smoothstep(lineWidth - 0.8, lineWidth + 0.8, latPixels),
    1 - smoothstep(lineWidth - 0.8, lineWidth + 0.8, lonPixels),
  );
}

/**
 * The themed-icon layer, drawn entirely in alpha.
 *
 * Android ignores this layer's colours and uses only its alpha as a mask,
 * filling it with the wallpaper's theme colour. A shaded globe here — the
 * obvious thing to draw — has an opaque disc, so the mask is a solid circle and
 * the launcher renders a plain filled blob with no globe in it at all.
 *
 * So the ink is the graticule and the limb; everything else is transparent.
 */
function sampleMonochrome(x, y, cx, cy, radius, lineWidth) {
  const here = geometry(x, y, cx, cy, radius);

  // The outline, measured from the disc edge so it survives at any size.
  const distance = Math.hypot(x - cx, y - cy);
  const outline = 1 - smoothstep(lineWidth * 0.9, lineWidth * 0.9 + 1.2, Math.abs(distance - radius));

  const grid = here ? gridAt(here, x, y, cx, cy, radius, lineWidth) : 0;

  return [255, 255, 255, clamp(Math.max(grid, outline))];
}

function sampleGlobe(x, y, cx, cy, radius, lineWidth) {
  const here = geometry(x, y, cx, cy, radius);
  if (!here) return [0, 0, 0, 0];

  const { nx, ny, nz } = here;

  // Lambert term, light from the upper left and slightly toward the viewer.
  // Kept gentle: a strong terminator makes the globe read as a moon phase.
  const light = clamp(nx * -0.34 + ny * -0.4 + nz * 0.85);
  const shade = 0.42 + 0.58 * Math.pow(light, 0.7);

  const sea = mixColour(SEA_DARK, SEA_LIGHT, shade);
  const grid = gridAt(here, x, y, cx, cy, radius, lineWidth);

  let colour = mixColour(sea, ACCENT, grid * (0.6 + 0.4 * shade));

  // A thin rim, to lift the sphere off a dark background without haloing it.
  const rim = Math.pow(clamp(1 - nz), 8);
  colour = mixColour(colour, ACCENT, rim * 0.45);

  return [...colour, 1];
}

/**
 * Render the globe into an RGBA buffer.
 *
 * `background` null leaves the surround transparent — what the adaptive
 * foreground and the monochrome layer want.
 */
function render(size, { diameter, background, monochrome = false }) {
  const pixels = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const radius = diameter / 2;
  const SAMPLES = 4; // 4×4 per pixel

  // Grid lines scale with the globe, so the icon looks the same at every size.
  const lineWidth = Math.max(LINE.minimum, diameter * LINE.ratio);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = x + (sx + 0.5) / SAMPLES;
          const py = y + (sy + 0.5) / SAMPLES;
          const [sr, sg, sb, sa] = monochrome
            ? sampleMonochrome(px, py, cx, cy, radius, lineWidth)
            : sampleGlobe(px, py, cx, cy, radius, lineWidth);
          r += sr * sa;
          g += sg * sa;
          b += sb * sa;
          a += sa;
        }
      }

      const total = SAMPLES * SAMPLES;
      const coverage = a / total;
      const index = (y * size + x) * 4;

      if (coverage <= 0.0001) {
        if (background) {
          pixels[index] = background[0];
          pixels[index + 1] = background[1];
          pixels[index + 2] = background[2];
          pixels[index + 3] = 255;
        }
        continue;
      }

      // Un-premultiply back to straight alpha.
      let cr = r / a;
      let cg = g / a;
      let cb = b / a;

      if (background) {
        cr = mix(background[0], cr, coverage);
        cg = mix(background[1], cg, coverage);
        cb = mix(background[2], cb, coverage);
      }

      pixels[index] = Math.round(clamp(cr, 0, 255));
      pixels[index + 1] = Math.round(clamp(cg, 0, 255));
      pixels[index + 2] = Math.round(clamp(cb, 0, 255));
      pixels[index + 3] = background ? 255 : Math.round(coverage * 255);
    }
  }

  return pixels;
}

/** A flat field, for the adaptive background layer. */
function solid(size, colour) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    pixels[i * 4] = colour[0];
    pixels[i * 4 + 1] = colour[1];
    pixels[i * 4 + 2] = colour[2];
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

// ------------------------------------------------------------------- outputs

const out = process.argv[2];
const S = 1024;

// Legacy square icon: the globe nearly fills it.
writePng(`${out}/icon.png`, S, S, render(S, { diameter: S * FILL.square, background: SPACE }));

// Adaptive foreground. Android crops to the inner 66% and may mask it to any
// shape, so the globe has to sit inside that safe circle.
writePng(
  `${out}/android-icon-foreground.png`,
  S,
  S,
  render(S, { diameter: S * FILL.adaptive, background: null }),
);

writePng(`${out}/android-icon-background.png`, S, S, solid(S, SPACE));

writePng(
  `${out}/android-icon-monochrome.png`,
  S,
  S,
  render(S, { diameter: S * FILL.adaptive, background: null, monochrome: true }),
);

// Splash: transparent, so it sits on whatever the splash background is.
writePng(`${out}/splash-icon.png`, S, S, render(S, { diameter: S * FILL.splash, background: null }));

writePng(`${out}/favicon.png`, 96, 96, render(96, { diameter: 96 * FILL.favicon, background: SPACE }));

console.log('wrote icon.png, android-icon-{foreground,background,monochrome}.png, splash-icon.png, favicon.png');

// --------------------------------------------------- Android launcher icons
//
// Written straight into res/mipmap-*, because `assets/` only reaches the app
// through `expo prebuild` — and prebuild would take the release signing config
// with it. These are the files that actually ship.
//
// Emitted as PNG next to the .webp files Expo generated; Android resolves
// either extension, and the caller deletes the stale .webp.

if (process.argv[3]) {
  const res = process.argv[3];
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

  for (const [density, scale] of Object.entries(densities)) {
    const dir = `${res}/mipmap-${density}`;

    // Legacy square icon: 48dp, globe nearly filling it.
    const legacy = Math.round(48 * scale);
    const legacyPixels = render(legacy, { diameter: legacy * FILL.square, background: SPACE });
    writePng(`${dir}/ic_launcher.png`, legacy, legacy, legacyPixels);
    writePng(`${dir}/ic_launcher_round.png`, legacy, legacy, legacyPixels);

    // Adaptive layers: a 108dp canvas of which only the middle 72dp is
    // guaranteed visible, so the globe is sized against that safe circle.
    const adaptive = Math.round(108 * scale);
    writePng(
      `${dir}/ic_launcher_foreground.png`,
      adaptive,
      adaptive,
      render(adaptive, { diameter: adaptive * FILL.adaptive, background: null }),
    );
    writePng(`${dir}/ic_launcher_background.png`, adaptive, adaptive, solid(adaptive, SPACE));
    writePng(
      `${dir}/ic_launcher_monochrome.png`,
      adaptive,
      adaptive,
      render(adaptive, { diameter: adaptive * FILL.adaptive, background: null, monochrome: true }),
    );
  }

  console.log('wrote res/mipmap-*/ic_launcher*.png');
}
