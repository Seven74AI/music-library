import { createCookieSessionStorage } from 'react-router'
import { getSessionSecret } from './env.server.ts'

export const verifySessionStorage = createCookieSessionStorage({
	cookie: {
		name: 'en_verification',
		sameSite: 'lax', // Must stay 'lax' — email verification links are cross-site navigations;
		// 'strict' would drop the verification cookie and break email-based flows.
		path: '/',
		httpOnly: true,
		maxAge: 60 * 10, // 10 minutes
		secrets: getSessionSecret(),
		secure: process.env.NODE_ENV === 'production',
	},
})
