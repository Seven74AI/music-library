import { createContext, RouterContextProvider, type ServerBuild } from "react-router";

export type ServerAppContext = {
  serverBuild: Promise<{ error: unknown; build: ServerBuild }>;
  nonce: string;
};

export const serverAppContext = createContext<ServerAppContext | null>(null);

export function createRouterLoadContext({ serverBuild, nonce }: ServerAppContext) {
  const context = new RouterContextProvider();
  context.set(serverAppContext, { serverBuild, nonce });
  return context;
}

export function getServerAppContext(context: Readonly<RouterContextProvider>) {
  return context.get(serverAppContext);
}
