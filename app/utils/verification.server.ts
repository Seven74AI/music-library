import { createCookieSessionStorage } from 'react-router'
import { getSessionSecret } from './env.server.ts'

export const verifySessionStorage = createCookieSessionStorage({
	cookie: {
		name: 'en_verification',
		sameSite: 'lax', // CSRF protection is advised if changing to 'none'
		path: '/',
		httpOnly: true,
		maxAge: 60 * 10, // 10 minutes
		secrets: getSessionSecret(),
		secure: process.env.NODE_ENV === 'production',
	},
})
