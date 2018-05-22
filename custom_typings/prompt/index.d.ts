declare module 'prompt' {
  export function start(): void;

  export function get(
    properties: { [key: string]: { [key: string]: any } },
    cb: (error: Error, result: any) => void
  ): void;
}
