/**
 * Work held back until a sheet has finished closing.
 *
 * Saving a flight used to update every page and clear the form in the same moment
 * the sheet started to slide away, so the slide began late and the form emptied on
 * its way out. One thing moves at a time: the sheet goes, then the rest happens
 * behind it, where a stall cannot be seen.
 */

export interface AfterClose {
  add(work: () => void): void;
  run(): void;
}

export function createAfterClose(): AfterClose {
  let waiting: Array<() => void> = [];

  return {
    add(work) {
      waiting.push(work);
    },

    run() {
      const due = waiting;
      waiting = [];

      const failures: unknown[] = [];
      for (const work of due) {
        try {
          work();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) throw failures[0];
    },
  };
}
