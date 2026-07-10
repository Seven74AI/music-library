export type PlayerKeyboardAction =
	| 'toggle-play-pause'
	| 'next'
	| 'previous'
	| 'volume-up'
	| 'volume-down'
	| 'mute-toggle'

export function shouldIgnoreKeyboardShortcut(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false

	if (target.isContentEditable) return true

	const tagName = target.tagName
	if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
		return true
	}

	return Boolean(target.closest('[contenteditable="true"]'))
}

export function getPlayerKeyboardAction(
	event: Pick<KeyboardEvent, 'key' | 'code' | 'target' | 'metaKey' | 'ctrlKey' | 'altKey'>,
): PlayerKeyboardAction | null {
	if (event.metaKey || event.ctrlKey || event.altKey) return null
	if (shouldIgnoreKeyboardShortcut(event.target)) return null

	switch (event.key) {
		case ' ':
		case 'k':
		case 'K':
			return 'toggle-play-pause'
		case 'ArrowRight':
			return 'next'
		case 'ArrowLeft':
			return 'previous'
		case 'ArrowUp':
			return 'volume-up'
		case 'ArrowDown':
			return 'volume-down'
		case 'm':
		case 'M':
			return 'mute-toggle'
		default:
			return null
	}
}

export function adjustVolumeStep(
	currentVolume: number,
	direction: 'up' | 'down',
	step = 0.05,
): number {
	const delta = direction === 'up' ? step : -step
	return Math.min(1, Math.max(0, currentVolume + delta))
}
