// The structural type of a translate function.
//
// Pure `lib/` modules that build user-facing strings (taskFormat, scanTime,
// translateBackendError) need translation but must not import next-intl —
// `lib/` is pure by default and next-intl is framework runtime. So callers pass
// the function in and these modules stay dependency-free and unit-testable with
// a stub.
//
// GENERIC OVER THE KEYS, deliberately. The obvious shape —
// `(key: string) => string` — does not work: next-intl's translator only
// accepts its own literal key union, and under `strictFunctionTypes` a function
// that accepts a narrow set of keys is NOT assignable to one advertising that it
// takes any string. Parameters are contravariant.
//
// Naming the exact keys instead flips that around and buys real safety: a
// module declares the keys it will ask for, and a namespace-scoped translator
// satisfies it only if every one of those keys exists in that namespace. Delete
// `due.tomorrow` from en.json and formatDue stops compiling.

export type TranslateValues = Record<string, string | number | Date>

export type Translate<Key extends string> = (key: Key, values?: TranslateValues) => string
