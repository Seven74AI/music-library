/**
 * For route modules that need clientAction when code-split.
 * Delegates to the server action while preserving return type.
 */
export async function proxyClientActionToServer<T>({
	serverAction,
}: {
	serverAction: () => Promise<T>
}): Promise<T> {
	return serverAction()
}
