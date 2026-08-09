/**
 * Error Boundary Component
 * 
 * Catches React errors and displays a fallback UI
 */

'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { logger } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null
        };
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        logger.error('React Error Boundary caught an error', error, errorInfo);
        this.setState({
            error,
            errorInfo
        });
    }

    handleReset = () => {
        this.setState({
            hasError: false,
            error: null,
            errorInfo: null
        });
        // Reload the page to reset state
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            // Custom fallback UI
            if (this.props.fallback) {
                return this.props.fallback;
            }

            // Default fallback UI
            return (
                <div className="min-h-screen flex items-center justify-center bg-background p-6">
                    <Card className="max-w-2xl w-full">
                        <CardHeader>
                            <div className="flex items-center gap-3">
                                <AlertTriangle className="h-6 w-6 shrink-0 text-destructive" aria-hidden="true" />
                                <CardTitle className="text-xl">
                                    Something went wrong
                                </CardTitle>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-5">
                            <p className="text-muted-foreground">
                                We hit an unexpected error. Don&apos;t worry, your data is safe.
                            </p>

                            {process.env.NODE_ENV === 'development' && this.state.error && (
                                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4">
                                    <p className="text-destructive font-mono text-sm mb-2">
                                        {this.state.error.toString()}
                                    </p>
                                    {this.state.errorInfo && (
                                        <pre className="text-muted-foreground font-mono text-xs overflow-auto max-h-48">
                                            {this.state.errorInfo.componentStack}
                                        </pre>
                                    )}
                                </div>
                            )}

                            <div className="flex gap-3">
                                <Button
                                    onClick={this.handleReset}
                                    className="h-11 px-5"
                                >
                                    Reload page
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => window.history.back()}
                                    className="h-11 px-5"
                                >
                                    Go back
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            );
        }

        return this.props.children;
    }
}
