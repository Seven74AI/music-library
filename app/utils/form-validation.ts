import { data } from 'react-router'

/**
 * Common form validation utilities
 */

export interface ValidationResult {
	success: boolean
	message?: string
	field?: string
}

/**
 * Validate required string field
 */
export function validateRequiredString(
	value: unknown, 
	fieldName: string
): ValidationResult {
	if (!value || typeof value !== 'string' || value.trim().length === 0) {
		return {
			success: false,
			message: `${fieldName} is required`,
			field: fieldName.toLowerCase()
		}
	}
	return { success: true }
}

/**
 * Validate action parameter
 */
export function validateAction(
	action: unknown, 
	validActions: readonly string[]
): ValidationResult {
	if (!action || !validActions.includes(action as string)) {
		return {
			success: false,
			message: 'Invalid or missing action'
		}
	}
	return { success: true }
}

/**
 * Create error response for form validation
 */
export function createValidationErrorResponse(
	message: string, 
	field?: string
) {
	return data({ error: message, field }, { status: 400 })
}
