/**
 * Type Guard Utilities
 * 
 * This file provides reusable helper functions for creating clean, consistent type guards.
 * These utilities eliminate repetitive casting and improve type guard readability.
 * 
 * @example
 * ```typescript
 * import { hasProperty, isString, isNumber } from '#app/types/frontend/type-guards'
 * 
 * export function isUser(obj: unknown): obj is User {
 *   if (!hasProperty(obj, 'id') || !hasProperty(obj, 'name')) return false
 *   return isString(obj.id) && isString(obj.name)
 * }
 * ```
 */

/**
 * Type guard to check if an object has a specific property
 * 
 * @param obj - The object to check
 * @param key - The property key to check for
 * @returns True if the object has the property
 */
export function hasProperty<K extends string>(
  obj: unknown, 
  key: K
): obj is Record<K, unknown> {
  return typeof obj === 'object' && obj !== null && key in obj
}

/**
 * Type guard to check if a value is a string
 * 
 * @param value - The value to check
 * @returns True if the value is a string
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

/**
 * Type guard to check if a value is a number
 * 
 * @param value - The value to check
 * @returns True if the value is a number
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number'
}

/**
 * Type guard to check if a value is a boolean
 * 
 * @param value - The value to check
 * @returns True if the value is a boolean
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

/**
 * Type guard to check if a value is a Date
 * 
 * @param value - The value to check
 * @returns True if the value is a Date
 */
export function isDate(value: unknown): value is Date {
  return value instanceof Date
}

/**
 * Type guard to check if a value is null
 * 
 * @param value - The value to check
 * @returns True if the value is null
 */
export function isNull(value: unknown): value is null {
  return value === null
}

/**
 * Type guard to check if a value is undefined
 * 
 * @param value - The value to check
 * @returns True if the value is undefined
 */
export function isUndefined(value: unknown): value is undefined {
  return value === undefined
}

/**
 * Type guard to check if a value is null or undefined
 * 
 * @param value - The value to check
 * @returns True if the value is null or undefined
 */
export function isNullOrUndefined(value: unknown): value is null | undefined {
  return value === null || value === undefined
}

/**
 * Type guard to check if a value is an array
 * 
 * @param value - The value to check
 * @returns True if the value is an array
 */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

/**
 * Type guard to check if a value is an object (not null, not array)
 * 
 * @param value - The value to check
 * @returns True if the value is an object
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Type guard to check if a value is a string or null
 * 
 * @param value - The value to check
 * @returns True if the value is a string or null
 */
export function isStringOrNull(value: unknown): value is string | null {
  return isString(value) || isNull(value)
}

/**
 * Type guard to check if a value is a number or null
 * 
 * @param value - The value to check
 * @returns True if the value is a number or null
 */
export function isNumberOrNull(value: unknown): value is number | null {
  return isNumber(value) || isNull(value)
}

/**
 * Type guard to check if a value is a Date or null
 * 
 * @param value - The value to check
 * @returns True if the value is a Date or null
 */
export function isDateOrNull(value: unknown): value is Date | null {
  return isDate(value) || isNull(value)
}
