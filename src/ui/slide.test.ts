import { describe, expect, it } from 'vitest';
import { PAGE_DIM } from './motion';
import { pageSlide } from './slide';

describe('pageSlide', () => {
  it('parks the pages nobody is looking at', () => {
    expect(pageSlide(2, 0, null, 1)).toEqual({
      visible: false,
      animated: false,
      from: 0,
      to: 0,
      opacityFrom: 0,
      opacityTo: 0,
    });
  });

  // The reason the flash existed: at rest the active page was still wired to
  // the transition value, so resetting that value before React had committed
  // the next render threw the whole screen a width sideways for one frame.
  it('leaves the resting page off the transition value entirely', () => {
    expect(pageSlide(0, 0, null, 1)).toEqual({
      visible: true,
      animated: false,
      from: 0,
      to: 0,
      opacityFrom: 1,
      opacityTo: 1,
    });
  });

  it('brings the incoming page in from the side it was tapped towards', () => {
    expect(pageSlide(1, 1, 0, 1)).toEqual({
      visible: true, animated: true, from: 1, to: 0, opacityFrom: PAGE_DIM, opacityTo: 1,
    });
    expect(pageSlide(0, 0, 1, -1)).toEqual({
      visible: true, animated: true, from: -1, to: 0, opacityFrom: PAGE_DIM, opacityTo: 1,
    });
  });

  it('sends the outgoing page the other way', () => {
    expect(pageSlide(0, 1, 0, 1)).toEqual({
      visible: true, animated: true, from: 0, to: -1, opacityFrom: 1, opacityTo: PAGE_DIM,
    });
    expect(pageSlide(1, 0, 1, -1)).toEqual({
      visible: true, animated: true, from: 0, to: 1, opacityFrom: 1, opacityTo: PAGE_DIM,
    });
  });

  it('never treats one page as both halves of the transition', () => {
    expect(pageSlide(1, 1, 1, 1)).toEqual({
      visible: true, animated: true, from: 1, to: 0, opacityFrom: PAGE_DIM, opacityTo: 1,
    });
  });

  // The page being left dims rather than disappearing: at no point in the
  // slide is half the screen blank.
  it('never fades a moving page past legible', () => {
    for (const slide of [pageSlide(1, 1, 0, 1), pageSlide(0, 1, 0, 1)]) {
      expect(Math.min(slide.opacityFrom, slide.opacityTo)).toBeGreaterThan(0.5);
    }
  });
});
