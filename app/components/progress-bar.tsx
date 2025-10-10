import { useNavigation } from 'react-router'
import { useSpinDelay } from 'spin-delay'
import { Progress } from './ui/progress'

function EpicProgress() {
	const transition = useNavigation()
	const busy = transition.state !== 'idle'
	const delayedPending = useSpinDelay(busy, {
		delay: 600,
		minDuration: 400,
	})

	const getProgressValue = () => {
		if (transition.state === 'submitting') return 50
		if (transition.state === 'loading') return 80
		return 0
	}

	if (!delayedPending) return null

	return (
		<div className="fixed inset-x-0 top-0 z-50">
			<Progress 
				value={getProgressValue()} 
				className="h-1 rounded-none"
			/>
		</div>
	)
}

export { EpicProgress }
