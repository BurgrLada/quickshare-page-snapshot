// SingleFile's frame tree only reports back through a global `browser` runtime, which Chrome lacks.
globalThis.browser ??= chrome;
