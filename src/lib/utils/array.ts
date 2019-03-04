/**
 * Transpose a 2D-array (flip diagonally).
 *
 * Note:
 * * All rows must have the same number of elements.
 * * All columns must have the same number of elements.
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
