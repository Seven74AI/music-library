/** For resource routes: client fetcher submits need clientAction when route modules are split. */
export async function proxyClientActionToServer({
	serverAction,
}: { serverAction: () => Promise<unknown> }) {
	return serverAction()
}
