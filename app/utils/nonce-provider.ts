import * as React from "react";

/**
 * SSR: entry.server wraps the tree with the request CSP nonce.
 * Client: leave the default `""` — browsers clear nonce attributes in the DOM
 * before JS runs, so hydrating with `""` matches. Do not read the real nonce
 * from the DOM into client JS (that defeats CSP nonce hiding).
 *
 * @see https://github.com/kentcdodds/nonce-hydration-issues
 */
export const NonceContext = React.createContext<string>("");
export const NonceProvider = NonceContext.Provider;
export const useNonce = () => React.useContext(NonceContext);
