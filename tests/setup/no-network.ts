// Loaded by both vitest projects (vitest.config.ts). Any global fetch from a test, or from the
// Worker under test (it shares the test isolate), fails instead of reaching the network. Bindings
// (Durable Objects, Workflows, the stubbed AI binding) do not go through global fetch, so they keep
// working. This blocks fetch only, which is what the app and its SDKs use; raw sockets are not
// intercepted.
const blocked: typeof fetch = async (input) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  throw new Error(`Network access is disabled in tests (attempted: ${url})`);
};

globalThis.fetch = blocked;
