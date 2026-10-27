'use client';

import * as React from 'react';

/**
 * Marks an element `data-shown` the first time it scrolls into view. CSS does
 * the animating (see globals.css "Reveal"): content is only hidden once the
 * <html class="js"> flag proves JavaScript runs, so without JS — or before
 * hydration on a slow connection — everything is simply visible.
 */
export function useReveal<T extends Element>(margin = '0px 0px -10% 0px') {
  return React.useCallback(
    (node: T | null) => {
      if (!node) return;
      if (!('IntersectionObserver' in window)) {
        node.setAttribute('data-shown', '');
        return;
      }
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            node.setAttribute('data-shown', '');
            io.disconnect();
          }
        },
        { rootMargin: margin }
      );
      io.observe(node);
      return () => io.disconnect();
    },
    [margin]
  );
}
