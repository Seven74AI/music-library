import type { ClientActionFunctionArgs } from 'react-router'

/** For resource routes: client fetcher submits need clientAction when route modules are split. */
export async function proxyClientActionToServer({
	serverAction,
}: Pick<ClientActionFunctionArgs, 'serverAction'>) {
	return serverAction()
}
