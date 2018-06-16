/**
 * An error that occurs when one of multiple Promises rejects.
 */
export class MultiPromiseRejectionError<T> extends Error {
  /**
   * The Errors that occurred.
   */
  private readonly _promiseErrors: ReadonlyArray<Error>;

  /**
   * Contract a new MultiPromiseRejectionError.
   *
   * @param multiPromiseResults - The results of the promises that were executed.
   */
  public constructor(
    multiPromiseResults: ReadonlyArray<
      { readonly value: T } | { readonly error: Error }
    >
  ) {
    super();

    // Extract out the errors.
    this._promiseErrors = multiPromiseResults.reduce(
      (previous: ReadonlyArray<Error>, current) => {
        // tslint:disable-next-line:no-any
        if ((current as any).error != undefined) {
          return [...previous, (current as { readonly error: Error }).error];
        }
        return previous;
      },
      []
    );

    Object.freeze(this._promiseErrors);
  }

  /**
   * Get the message for this error.
   */
  public get message(): string {
    const errorsOutput = this._promiseErrors.reduce((stringOutput, error) => {
      const errorMessage =
        error.stack === undefined ? error.message : `${error.stack}\n`;

      return `${stringOutput}\n  - ${errorMessage}`;
    }, '');

    return `${this._promiseErrors.length} out of ${
      this._promiseErrors.length
    } promise were rejected.\nRejected errors:${errorsOutput}`;
  }

  /**
   * Get the errors.
   */
  public get errors(): ReadonlyArray<Error> {
    return this._promiseErrors;
  }
}
