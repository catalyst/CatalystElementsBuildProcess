/**
 * An error caused by something internal.
 */
export class InternalError extends Error {
  public constructor(message: string) {
    super(message);
  }
}
