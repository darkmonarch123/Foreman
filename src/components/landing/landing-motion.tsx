"use client";

import { useEffect } from "react";
import { LABEL_OPACITY, STORY_LAYOUTS, applyNoteStyle } from "./story-layouts";

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * Every scroll-linked effect on the landing page, driven by one passive scroll
 * listener and one animation frame at a time.
 *
 * It marks the page `data-motion="on"` (or "reduced"); the CSS that dims or hides
 * content before it is revealed only applies after that, so the page is fully
 * readable without JavaScript. With reduced motion there is no parallax, tilt,
 * scaling or reveal; the story changes step without moving.
 */
export function LandingMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".site");
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.dataset.motion = reduce ? "reduced" : "on";

    // Reveal on scroll.
    let observer: IntersectionObserver | null = null;
    const reveals = [...root.querySelectorAll<HTMLElement>("[data-reveal]")];
    if (!reduce && "IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-in");
              observer?.unobserve(entry.target);
            }
          }
        },
        { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
      );
      reveals.forEach((element) => observer?.observe(element));
    } else {
      reveals.forEach((element) => element.classList.add("is-in"));
    }

    const hero = root.querySelector<HTMLElement>("[data-hero]");
    const win = root.querySelector<HTMLElement>("[data-window]");
    const ctaTitle = root.querySelector<HTMLElement>("[data-cta-title]");
    const statement = root.querySelector<HTMLElement>("[data-statement]");
    const words = statement ? [...statement.querySelectorAll<HTMLElement>(":scope > span")] : [];
    const story = root.querySelector<HTMLElement>("[data-story]");
    const notes = story ? [...story.querySelectorAll<HTMLElement>("[data-note]")] : [];
    const labels = story ? [...story.querySelectorAll<HTMLElement>("[data-story-label]")] : [];
    const steps = story ? [...story.querySelectorAll<HTMLElement>("[data-step]")] : [];
    const bar = story?.querySelector<HTMLElement>("[data-story-bar]");

    let frame = 0;
    const update = () => {
      frame = 0;
      const vh = window.innerHeight;
      const y = window.scrollY;

      if (!reduce) {
        if (hero) {
          const h = clamp(y / (vh * 0.7));
          hero.style.transform = `translateY(${y * 0.25}px) scale(${1 - h * 0.05})`;
          hero.style.opacity = String(1 - h * 0.9);
        }
        if (win) {
          const t = ease(clamp((vh - win.getBoundingClientRect().top) / (vh * 0.75)));
          win.style.transform = `perspective(1400px) rotateX(${(1 - t) * 18}deg) scale(${0.92 + t * 0.08})`;
        }
        if (ctaTitle) {
          const t = ease(clamp((vh - ctaTitle.getBoundingClientRect().top) / (vh * 0.6)));
          ctaTitle.style.transform = `scale(${0.8 + t * 0.2})`;
          ctaTitle.style.opacity = String(0.2 + t * 0.8);
        }
        if (statement && words.length) {
          const rect = statement.getBoundingClientRect();
          const progress = clamp((vh * 0.8 - rect.top) / (rect.height + vh * 0.35));
          words.forEach((word, index) => {
            word.style.opacity = String(clamp(progress * words.length - index, 0.16, 1));
          });
        }
      }

      if (story) {
        const total = story.offsetHeight - vh;
        const progress = total > 0 ? clamp(-story.getBoundingClientRect().top / total) : 0;
        if (bar) bar.style.transform = `scaleX(${progress})`;
        let s = clamp(progress * 2.4 - 0.2, 0, 2);
        if (reduce) s = Math.round(s);
        const i0 = Math.min(Math.floor(s), 1);
        const f = ease(clamp(s - i0));
        notes.forEach((note, k) => {
          const a = STORY_LAYOUTS[i0][k];
          const b = STORY_LAYOUTS[i0 + 1][k];
          applyNoteStyle(
            note,
            a.map((value, j) => lerp(value, b[j], f)),
          );
        });
        labels.forEach((label, k) => {
          label.style.opacity = String(lerp(LABEL_OPACITY[i0][k], LABEL_OPACITY[i0 + 1][k], f));
        });
        const active = s < 0.5 ? 0 : s < 1.5 ? 1 : 2;
        steps.forEach((step, k) => {
          step.classList.toggle("is-on", k === active);
        });
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
      delete root.dataset.motion;
    };
  }, []);

  return null;
}
