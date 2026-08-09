/**
 * The app's own dialogs, in place of the system alert.
 *
 * `Alert.alert` draws whatever the OS draws — a white Material box in the
 * middle of a dark map, with its own idea of button order and typography. This
 * keeps the app looking like one thing.
 *
 * Split from the component that draws it because the interesting part is not
 * the drawing: it is that asking returns a promise, that a second question
 * queues instead of replacing the first, and that a stale tap cannot answer the
 * dialog that replaced the one it was aimed at.
 */

export interface DialogOptions {
  title: string;
  message?: string;
  confirmLabel: string;
  /** Omit for a plain notice with a single button. */
  cancelLabel?: string;
  /** Draws the confirm button as a warning. */
  destructive?: boolean;
}

export interface DialogRequest {
  id: number;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string | null;
  destructive: boolean;
}

interface Pending {
  request: DialogRequest;
  settle: (confirmed: boolean) => void;
}

let queue: Pending[] = [];
let listeners: (() => void)[] = [];
let nextId = 1;

function announce(): void {
  for (const listener of listeners) listener();
}

/**
 * Put a question on screen. Resolves true if confirmed, false otherwise.
 *
 * A notice with one button also resolves — as true — so callers can await it
 * without caring which kind it was.
 */
export function ask(options: DialogOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    queue.push({
      request: {
        id: nextId++,
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel,
        cancelLabel: options.cancelLabel ?? null,
        destructive: options.destructive ?? false,
      },
      settle: resolve,
    });

    announce();
  });
}

/** The dialog that should be on screen, or null. */
export function current(): DialogRequest | null {
  return queue[0]?.request ?? null;
}

/**
 * Answer the dialog on screen.
 *
 * Ignores an id that is not at the front: a tap landing after the dialog it
 * belonged to has gone would otherwise answer whichever question replaced it.
 */
export function answer(id: number, confirmed: boolean): void {
  const front = queue[0];
  if (!front || front.request.id !== id) return;

  queue = queue.slice(1);
  front.settle(confirmed);
  announce();
}

export function subscribe(listener: () => void): () => void {
  listeners = [...listeners, listener];

  return () => {
    listeners = listeners.filter((existing) => existing !== listener);
  };
}

/** Test seam. Drops everything without settling. */
export function reset(): void {
  queue = [];
  listeners = [];
  nextId = 1;
}
