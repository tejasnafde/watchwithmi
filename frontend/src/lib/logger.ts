/**
 * Centralized Logging Utility
 * 
 * Provides consistent logging across the application with proper formatting
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LoggerConfig {
    enableDebug: boolean;
    prefix: string;
}

const config: LoggerConfig = {
    enableDebug: process.env.NODE_ENV === 'development',
    prefix: '[WatchWithMi]'
};

const formatMessage = (level: LogLevel, message: string): string => {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    const emoji = {
        info: 'ℹ️',
        warn: '⚠️',
        error: '❌',
        debug: '🐛'
    }[level];

    return `${emoji} ${config.prefix} [${timestamp}] ${message}`;
};

export const logger = {
    info: (message: string, ...args: any[]) => {
        console.log(formatMessage('info', message), ...args);
    },

    warn: (message: string, ...args: any[]) => {
        console.warn(formatMessage('warn', message), ...args);
    },

    error: (message: string, error?: Error | unknown, ...args: any[]) => {
        console.error(formatMessage('error', message), error, ...args);

        // Log stack trace in development
        if (config.enableDebug && error instanceof Error && error.stack) {
            console.error('Stack trace:', error.stack);
        }
    },

    debug: (message: string, ...args: any[]) => {
        if (config.enableDebug) {
            console.debug(formatMessage('debug', message), ...args);
        }
    },

    // Group related logs
    group: (label: string, fn: () => void) => {
        if (config.enableDebug) {
            console.group(formatMessage('debug', label));
            fn();
            console.groupEnd();
        }
    },

    // Log with custom emoji
    custom: (emoji: string, message: string, ...args: any[]) => {
        console.log(`${emoji} ${config.prefix} ${message}`, ...args);
    }
};

// Export for testing/configuration
export const configureLogger = (newConfig: Partial<LoggerConfig>) => {
    Object.assign(config, newConfig);
};
