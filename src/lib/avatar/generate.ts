/**
 * Local avatar generator.
 *
 * Avatars are simple illustrated portraits drawn from a random seed and the
 * person's initial avatar preference. Nothing about a person (name, email,
 * id) goes into the drawing, and no third-party service is involved. An
 * avatar is a placeholder illustration, not a likeness.
 */

export type AvatarStyle = "male" | "female";

export const AVATAR_SEED_PATTERN = /^[a-z0-9]{8,32}$/;

export function isAvatarStyle(value: string): value is AvatarStyle {
  return value === "male" || value === "female";
}

const BACKGROUNDS = ["#A8D8F0", "#AEB9F4", "#A8DDB2", "#F8DD72", "#F3A5A0", "#E9ECFC", "#FDF5D4", "#E6F5E9"];
const SKIN = ["#F6D7C3", "#EBC1A4", "#D9A481", "#B97F5E", "#8D5A3F", "#63402D"];
const HAIR = ["#1D1A18", "#3A2A20", "#5B3A26", "#8A5A34", "#B7813F", "#D8B26A", "#7A7774", "#A7402B"];
const TOPS = ["#121212", "#2F4B7C", "#3C6E57", "#8E3B46", "#5A4E8C", "#FFFFFF", "#C9622F", "#3B3B3B"];

function hash(seed: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

function generator(seed: string): () => number {
  let state = hash(seed) || 1;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

const SHORT_HAIR = [
  // crop
  '<path d="M34 46c0-15 9-25 26-25s26 10 26 25c0 2-1 3-2 0-2-9-8-13-24-13S38 37 36 46c-1 3-2 2-2 0Z"/>',
  // side part
  '<path d="M33 48c-1-17 9-28 27-28 16 0 28 9 27 27-1 3-3 2-3-1-1-9-5-12-12-14-10 3-22 3-33 0-3 4-4 9-4 15 0 3-2 4-2 1Z"/>',
  // curly top
  '<path d="M34 45c-3-6 0-13 6-15 2-6 9-9 14-6 5-4 13-3 16 2 7 0 12 6 11 13 2 3 2 6 1 8-1 2-2 1-3-1-1-7-6-11-19-11s-19 4-20 11c-1 3-4 3-6-1Z"/>',
  // buzz
  '<path d="M35 45c0-14 10-23 25-23s25 9 25 23c-3-8-10-12-25-12s-22 4-25 12Z" opacity="0.85"/>',
];

const LONG_HAIR = [
  // long straight
  '<path d="M31 50c-2-19 9-31 29-31s31 12 29 31c-1 14 1 25 4 33H72c3-10 4-20 3-32-2-9-7-13-15-13s-13 4-15 13c-1 12 0 22 3 32H27c3-8 5-19 4-33Z"/>',
  // bob
  '<path d="M31 52c-2-20 9-33 29-33s31 13 29 33c-1 8 0 13 2 17H74c2-6 2-12 1-18-3-9-7-12-15-12s-12 3-15 12c-1 6-1 12 1 18H29c2-4 3-9 2-17Z"/>',
  // bun
  '<circle cx="60" cy="17" r="9"/><path d="M33 48c-1-16 9-27 27-27s28 11 27 27c0 3-2 3-3 0-2-9-8-14-24-14S38 39 36 48c-1 3-3 3-3 0Z"/>',
  // wavy long
  '<path d="M30 49c-2-18 10-30 30-30s32 12 30 30c-1 9 3 13 2 20-1 6-5 9-3 14H72c4-9 5-21 3-32-2-9-7-12-15-12s-13 3-15 12c-2 11-1 23 3 32H31c2-5-2-8-3-14-1-7 3-11 2-20Z"/>',
];

export function generateAvatarSvg(style: AvatarStyle, seed: string): string {
  const random = generator(`${style}:${seed}`);
  const background = pick(random, BACKGROUNDS);
  const skin = pick(random, SKIN);
  const hair = pick(random, HAIR);
  let top = pick(random, TOPS);
  if (top === background) top = "#121212";
  const hairShape = pick(random, style === "male" ? SHORT_HAIR : LONG_HAIR);
  const smile = 3 + Math.floor(random() * 4);
  const eyeOffset = 9 + Math.floor(random() * 3);
  const cheek = random() > 0.5;
  // Long hair is drawn behind the shoulders; short hair on top of the head only.
  const hairBehind = style === "female";

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="Generated avatar">',
    `<rect width="120" height="120" fill="${background}"/>`,
    hairBehind ? `<g fill="${hair}">${hairShape}</g>` : "",
    `<path d="M22 120c2-22 16-33 38-33s36 11 38 33Z" fill="${top}"/>`,
    `<path d="M51 74h18v14c0 5-4 9-9 9s-9-4-9-9Z" fill="${skin}"/>`,
    `<path d="M51 82c5 4 13 4 18 0v4c-5 4-13 4-18 0Z" fill="#000" opacity="0.12"/>`,
    `<ellipse cx="60" cy="54" rx="23" ry="26" fill="${skin}"/>`,
    hairBehind
      ? `<g fill="${hair}"><path d="M36 47c1-13 10-21 24-21s23 8 24 21c-5-7-13-10-24-10s-19 3-24 10Z"/></g>`
      : `<g fill="${hair}">${hairShape}</g>`,
    `<circle cx="${60 - eyeOffset}" cy="55" r="2.4" fill="#1D1A18"/>`,
    `<circle cx="${60 + eyeOffset}" cy="55" r="2.4" fill="#1D1A18"/>`,
    cheek
      ? `<circle cx="${60 - eyeOffset - 3}" cy="63" r="3.5" fill="#E8776F" opacity="0.28"/><circle cx="${60 + eyeOffset + 3}" cy="63" r="3.5" fill="#E8776F" opacity="0.28"/>`
      : "",
    `<path d="M${60 - 7} 66q7 ${smile} 14 0" fill="none" stroke="#1D1A18" stroke-width="2" stroke-linecap="round"/>`,
    "</svg>",
  ].join("");
}
