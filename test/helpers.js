export function installChrome(seed = {}) {
  const local = new Map(Object.entries(seed.local || {}));
  const session = new Map(Object.entries(seed.session || {}));

  function store(map) {
    return {
      async get(keys) {
        if (keys == null) return Object.fromEntries(map);
        const list = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const key of list) out[key] = map.get(key);
        return out;
      },
      async set(values) {
        for (const [key, value] of Object.entries(values)) map.set(key, value);
      },
      async remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) map.delete(key);
      },
    };
  }

  globalThis.chrome = {
    storage: {
      local: store(local),
      session: store(session),
    },
    runtime: {
      getURL: (path) => `chrome-extension://test${path}`,
    },
  };
  return { local, session };
}

export function installOfflineFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  return () => {
    globalThis.fetch = original;
  };
}

export function browserUi(patch = {}) {
  return {
    lastCollectionId: null,
    lastTab: "collections",
    apiBase: "http://127.0.0.1:8080",
    storageMode: "browser",
    ...patch,
  };
}

export function installOfflineExtension(seed = {}) {
  const restoreFetch = installOfflineFetch();
  const storage = installChrome({
    local: {
      "myWorkflow.ui": browserUi(seed.ui),
      ...(seed.local || {}),
    },
    session: seed.session,
  });
  return { ...storage, restoreFetch };
}
