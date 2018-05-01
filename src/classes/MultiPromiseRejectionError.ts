export default class MultiPromiseRejectionError extends Error {
  private errors: Error[];
  private telly: number;

  /**
   * Contract a new MultiPromiseRejectionError.
   *
   * @param multiPromiseResults - The results of the promises that were executed.
   */
  constructor(multiPromiseResults: any[]) {
    super();
    this.errors = [];
    this.telly = multiPromiseResults.length;
    for (const result of multiPromiseResults) {
      if (result.status !== 0) {
        this.errors.push(result.error);
      }
    }
  }

  /**
   * Get the message of this error.
   */
  get message(): string {
    return `${this.errors.length} out of ${
      this.telly
    } promise were rejected.\nRejected errors:\n  - ${this.errors.join(
      '\n  - '
    )}`;
  }
}
