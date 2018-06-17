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
  public constructor(multiPromiseResults: ReadonlyArray<ISuccessResult<T> | IErrorResult>) {
    super();

    // Extract out the errors.
    this._promiseErrors = multiPromiseResults.reduce(
      (previous: ReadonlyArray<Error>, current) => {
        return (
          // tslint:disable-next-line:no-any
          (current as any).error == undefined
            ? previous
            : [...previous, (current as IErrorResult).error]
        );
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

/**
 * A successful result.
 */
interface ISuccessResult<T> {
  readonly value: T;
}

/**
 * An unsuccessful result.
 */
interface IErrorResult {
  readonly error: Error;
}
