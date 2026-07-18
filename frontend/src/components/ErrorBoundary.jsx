import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) {
      // Do not log component props/state because they may contain account data.
      console.error("[ui] Uncaught React error", error?.name, error?.message, info?.componentStack);
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <section className="w-full max-w-lg rounded-xl border border-rose-200 bg-white p-8 text-center shadow-sm dark:border-rose-900 dark:bg-slate-900">
          <AlertTriangle className="mx-auto h-10 w-10 text-rose-500" />
          <h1 className="mt-5 text-xl font-bold">Đã xảy ra lỗi. Thử tải lại trang</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
            Dữ liệu của bạn chưa bị thay đổi. Hãy tải lại để khôi phục màn hình.
          </p>
          <button type="button" className="primary-button mt-6" onClick={() => window.location.reload()}>
            <RefreshCw className="h-4 w-4" />
            Tải lại trang
          </button>
        </section>
      </main>
    );
  }
}
