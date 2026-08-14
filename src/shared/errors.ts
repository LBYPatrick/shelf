/**
 * Turning a caught value into something to show someone.
 *
 * `catch` binds `unknown`, so every call site that wanted to display a failure
 * wrote the same instanceof-and-String dance — fourteen copies of it in the
 * renderer alone, which is fourteen chances for one of them to print
 * `[object Object]` instead.
 */
export function errorMessage(caught: unknown): string {
  if (caught instanceof Error) return caught.message;
  if (typeof caught === 'string') return caught;

  // A rejected value that is neither is almost always a structured-clone of an
  // error that lost its prototype crossing the process boundary.
  if (caught !== null && typeof caught === 'object' && 'message' in caught) {
    const { message } = caught as { message: unknown };
    if (typeof message === 'string') return message;
  }

  return String(caught);
}
