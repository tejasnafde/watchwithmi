/**
 * Centralized Type Definitions
 * 
 * Re-exports all types for easy importing
 */

// Socket types
export * from './socket';

// Media types
export * from './media';

// Common utility types
export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type AsyncResult<T> = Promise<T>;
