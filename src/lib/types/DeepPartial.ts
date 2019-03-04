// tslint:disable: readonly-array

/**
 * Same as Partial<T> but goes deeper and makes Partial<T> all its properties and sub-properties.
 *
 * @see https://github.com/typeorm/typeorm/blob/master/src/common/DeepPartial.ts
 */
export type DeepPartial<T> = {
  [P in keyof T]?:
    T[P] extends Array<infer U> ? Array<DeepPartial<U>> :
    T[P] extends ReadonlyArray<infer V> ? ReadonlyArray<DeepPartial<V>> :
    DeepPartial<T[P]>
};
