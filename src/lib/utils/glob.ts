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
): Promise<Array<string>> {
  return (
    Array.isArray(pattern)
      ? globArray(pattern, options)
      : globString(pattern as string, options)
  );
}

/**
 * Do a glob matching with a string pattern.
 */
async function globString(
  pattern: string,
  options?: nodeGlob.IOptions
): Promise<Array<string>> {
  return nodeGlobPromise(pattern, options);
}

/**
 * Do a glob matching with an array of string pattern.
 */
async function globArray(
  pattern: ReadonlyArray<string>,
  options?: nodeGlob.IOptions
): Promise<Array<string>> {
  return (
      pattern.length === 0
    ?   Promise.reject(new Error('No glob patterns given.'))
    : pattern.length === 1
    ?   nodeGlobPromise(pattern[0], options)
    :   nodeGlobPromise(`{${pattern.join(',')}}`, options)
  );
}
