/**
 * Where each page sits during a tab transition, in screen widths.
 *
 * This is pulled out of the component for one reason: the container that draws
 * a page must be the same React element type in every one of these states. Two
 * bugs lived here. Returning a plain View while hidden and an Animated.View
 * while visible made React unmount and rebuild the whole subtree on every
 * switch — MapLibre's native map torn down and re-created, every screen's
 * database effect re-run. And keeping the resting page wired to the transition
 * value meant resetting that value (which happens before React commits the
 * next render) threw the visible screen a full width sideways for one frame.
 * A page at rest is deliberately `animated: false`, attached to nothing.
 */
import { PAGE_DIM } from './motion';

export interface PageSlide {
  /** Inside the viewport at all, rather than parked behind it. */
  visible: boolean;
  /** Position driven by the transition value, rather than fixed. */
  animated: boolean;
  /** Offset at transition progress 0, in screen widths. */
  from: number;
  /** Offset at transition progress 1, in screen widths. */
  to: number;
  /** Opacity at transition progress 0. Also the resting opacity. */
  opacityFrom: number;
  /** Opacity at transition progress 1. */
  opacityTo: number;
}

export function pageSlide(
  tabIndex: number,
  activeIndex: number,
  prevIndex: number | null,
  slideDir: 1 | -1,
): PageSlide {
  if (tabIndex === activeIndex) {
    // No transition running: sit still, off the animated graph.
    if (prevIndex === null) {
      return { visible: true, animated: false, from: 0, to: 0, opacityFrom: 1, opacityTo: 1 };
    }
    return {
      visible: true,
      animated: true,
      from: slideDir,
      to: 0,
      opacityFrom: PAGE_DIM,
      opacityTo: 1,
    };
  }

  if (tabIndex === prevIndex) {
    return {
      visible: true,
      animated: true,
      from: 0,
      to: -slideDir,
      opacityFrom: 1,
      opacityTo: PAGE_DIM,
    };
  }

  return { visible: false, animated: false, from: 0, to: 0, opacityFrom: 0, opacityTo: 0 };
}
