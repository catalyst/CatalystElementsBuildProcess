/**
 * Returns a new 2D array that is a transposed version of the original.
 *
 * Note:
 * * All rows must have the same number of elements as each other.
 * * All columns must have the same number of elements as each other.
 */
export function transpose<T>(
  array: ReadonlyArray<ReadonlyArray<T>>
// tslint:disable-next-line: readonly-array
): Array<Array<T>> {
  return (
    array.length === 0
      ? []
      : array[0].map((_, index) => array.map((row) => row[index]))
  );
}
