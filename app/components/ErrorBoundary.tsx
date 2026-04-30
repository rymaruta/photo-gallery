"use client";

import React, { Component, ReactNode } from "react";

type Props = {
    children: ReactNode;
    fallback?: ReactNode;
};

type State = {
    hasError: boolean;
    error?: Error;
};

export default class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        // Log to console in dev; replace with error reporting service in prod
        console.error("[ErrorBoundary]", error, info.componentStack);
    }

    render() {
        if (this.state.hasError) {
            return this.props.fallback ?? (
                <div className="min-h-screen bg-black flex items-center justify-center px-4">
                    <div className="text-center max-w-sm">
                        <p className="text-white/60 text-sm mb-4">
                            予期しないエラーが発生しました。
                        </p>
                        <button
                            onClick={() => this.setState({ hasError: false })}
                            className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-sm rounded-md transition-colors"
                        >
                            再試行
                        </button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}
