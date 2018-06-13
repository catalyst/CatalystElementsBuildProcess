/**
 * An error that occurs when one of multiple Promises rejects.
 */
export class MultiPromiseRejectionError<T> extends Error {
  /**
   * The Errors that occurred.
   */
  private readonly promiseErrors: ReadonlyArray<Error>;

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
    this.promiseErrors = multiPromiseResults.reduce(
      (previous: ReadonlyArray<Error>, current) => {
        if ((current as any).error != null) {
          return [...previous, (current as { readonly error: Error }).error];
        }
        return previous;
      },
      []
    );

    Object.freeze(this.promiseErrors);
  }

  /**
   * Get the message for this error.
   */
  public get message(): string {
    const errorsOutput = this.promiseErrors.reduce((stringOutput, error) => {
      return `${stringOutput}\n  - ${
        error.stack === undefined ? error.message : `${error.stack}\n`
      }`;
    }, '');

    return `${this.promiseErrors.length} out of ${
      this.promiseErrors.length
    } promise were rejected.\nRejected errors:${errorsOutput}`;
  }

  /**
   * Get the errors.
   */
  public get errors(): ReadonlyArray<Error> {
    return this.promiseErrors;
  }
}
