/**
 * An error caused by something external.
 */
export class ExternalError extends Error {
  public constructor(message: string) {
    super(message);
  }
}
