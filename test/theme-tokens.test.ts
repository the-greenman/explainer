// Core rendering code holds no colour, font-family, font-size, font-weight or line-height literal: every such value
// comes from src/theme.ts (the contract). Modelled on muDemocracy.org scripts/check-type-tokens.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const files = [
  ...readdirSync(join(root, 'src/components')).filter((n) => n.endsWith('.ts')).map((n) => `src/components/${n}`),
  'src/player.ts',
  'src/path-view.ts',
];

const NAMED = 'aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgrey|darkgreen|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|grey|green|greenyellow|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgrey|lightgreen|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen';

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const FONT_PROP = /(?<![\w-])(font-size|font-family|font-weight|line-height|fontSize|fontFamily|fontWeight|lineHeight)\s*:\s*([^;"'`\n$]*(?:\$\{[^}]*\}[^;"'`\n$]*)*)/g;
const COLOUR_PROP = /(?<![\w-])((?:background|border|outline|text-decoration|box-shadow|text-shadow|fill|stroke|color|caret-color|accent-color)(?:-[a-z]+)*)\s*:\s*([^;"'`\n$]*(?:\$\{[^}]*\}[^;"'`\n$]*)*)/g;

/** Returns the offending snippets in `src` (empty when it is clean). */
export function scan(src: string): string[] {
  const code = stripComments(src);
  const bad: string[] = [];
  for (const m of code.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) bad.push(`hex colour ${m[0]}`);
  for (const m of code.matchAll(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix|color)\(/g)) bad.push(`colour function ${m[0]}`);
  if (/var\(\s*--/.test(code)) bad.push('custom property read outside src/theme.ts');
  for (const m of code.matchAll(COLOUR_PROP)) {
    const value = m[2].replace(/\$\{[^}]*\}/g, ' ');
    for (const w of value.matchAll(new RegExp(`(?<![\\w-])(${NAMED})(?![\\w-])`, 'gi'))) bad.push(`named colour ${m[1]}: ${w[0]}`);
  }
  for (const m of code.matchAll(FONT_PROP)) {
    const value = m[2].trim();
    if (value === 'inherit') continue;
    // allowed: only interpolations of theme tokens (identifiers, optionally in a ternary): no digits or quotes inside
    const rest = value.replace(/\$\{([^}]*)\}/g, (_, inner: string) => (/[\d'"`]/.test(inner) ? '\u0000' : ''));
    if (value.includes('${') && rest.trim() === '') continue;
    bad.push(`${m[1]}: ${value}`);
  }
  return bad;
}

for (const f of files) {
  test(`${f} uses only theme tokens for colour and type`, () => {
    assert.deepEqual(scan(readFileSync(join(root, f), 'utf8')), []);
  });
}

test('the scanner catches the pre-contract code', () => {
  const old = [
    "node.setAttribute('style', `${FONT};background:rgba(12,14,22,.7);color:#fff;`);",
    "h.setAttribute('style', 'margin:0;font-size:10cqw;line-height:1.15;color:#fff');",
    "ol.setAttribute('style', `font-size:${panel ? '7.5cqw' : '1.3rem'}`);",
    "li.setAttribute('style', 'font-weight:700;color:var(--explainer-accent,#06c)');",
    "el.setAttribute('style', 'font-family:system-ui;color:white;border:1px solid black');",
    "const FONT = 'font-family:var(--explainer-font,system-ui,sans-serif)';",
  ];
  for (const line of old) assert.notEqual(scan(line).length, 0, line);
  assert.ok(scan(old[1]).some((b) => b.startsWith('font-size')));
  assert.ok(scan(old[1]).some((b) => b.startsWith('line-height')));
  assert.ok(scan(old[2]).some((b) => b.startsWith('font-size')));
  assert.ok(scan(old[3]).some((b) => b.startsWith('font-weight')));
  assert.ok(scan(old[4]).some((b) => b.startsWith('named colour color')));
});

test('the scanner passes token use', () => {
  assert.deepEqual(scan("h.setAttribute('style', `margin:0;font-size:${panel ? SIZE_A : SIZE_B};color:${INK}`);"), []);
  assert.deepEqual(scan("// background: #fff in a comment\nx.setAttribute('style', 'font:inherit;all:unset;text-decoration-color:transparent;border-left:1px solid currentColor');"), []);
});
