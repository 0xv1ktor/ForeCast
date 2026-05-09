export function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function walletProviderWithPublicKey(provider, publicKey) {
  return new Proxy(provider, {
    get(target, prop) {
      if (prop === 'publicKey') return publicKey;
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
