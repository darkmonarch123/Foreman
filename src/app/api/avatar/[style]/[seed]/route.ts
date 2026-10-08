import { AVATAR_SEED_PATTERN, generateAvatarSvg, isAvatarStyle } from "@/lib/avatar/generate";

/**
 * Serves a generated avatar illustration. Public by design: the URL contains
 * only a random seed and a style, never anything that identifies a person.
 */
export async function GET(_request: Request, context: { params: Promise<{ style: string; seed: string }> }) {
  const { style, seed } = await context.params;
  if (!isAvatarStyle(style) || !AVATAR_SEED_PATTERN.test(seed)) {
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return new Response(generateAvatarSvg(style, seed), {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      // The SVG is static markup; forbid everything if it is ever opened directly.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
