module.exports = class MultiPromiseRejectionError extends Error {
  /**
   * Contract a new MultiPromiseRejectionError.
   *
   * @param {Object[]} multiPromiseResults - The results of the promises that were executed.
   */
  constructor(multiPromiseResults) {
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
   *
   * @returns {string}
   */
  get message() {
    return `${this.errors.length} out of ${this.telly} promise were rejected.
Rejected errors:
  - ${this.errors.join('  - \n')}`;
  }
};
