import { ExternalError } from '.';

/**
 * An error caused by an invalid config.
 */
export class EnvironmentError extends ExternalError {
  public constructor(
    environment: string | undefined = process.env.NODE_ENV,
    message: string = 'Unknown environment'
  ) {
    super(`${message} "${environment}".`);
  }
}
