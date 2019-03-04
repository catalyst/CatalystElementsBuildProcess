import nodeGlob from 'glob';
import { promisify } from 'util';

// Promisified functions.
const nodeGlobPromise = promisify(nodeGlob);

/**
 * Glob matching with support for multiple patterns.
 */
export async function glob(
  pattern: string | ReadonlyArray<string>,
  options?: nodeGlob.IOptions
// tslint:disable-next-line: readonly-array
): Promise<Array<string>> {
  return (
    Array.isArray(pattern)
      ? globArray(pattern, options)
      : globString(pattern as string, options)
  );
}

async function globString(
  pattern: string,
  options?: nodeGlob.IOptions
// tslint:disable-next-line: readonly-array
): Promise<Array<string>> {
  return nodeGlobPromise(pattern, options);
}

async function globArray(
  pattern: ReadonlyArray<string>,
  options?: nodeGlob.IOptions
// tslint:disable-next-line: readonly-array
): Promise<Array<string>> {
  return (
      pattern.length === 0
    ?   Promise.reject(new Error('No glob patterns given.'))
    : pattern.length === 1
    ?   nodeGlobPromise(pattern[0], options)
    :   nodeGlobPromise(`{${pattern.join(',')}}`, options)
  );
}
