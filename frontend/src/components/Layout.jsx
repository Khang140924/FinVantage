import Sidebar from "./Sidebar.jsx";
import Topbar from "./Topbar.jsx";

export default function Layout({
  activePage,
  pageTitle,
  onNavigate,
  searchQuery,
  onSearchChange,
  darkMode,
  onToggleTheme,
  children,
}) {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Sidebar activePage={activePage} onNavigate={onNavigate} />
      <div className="min-h-screen lg:pl-72">
        <Topbar
          pageTitle={pageTitle}
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          darkMode={darkMode}
          onToggleTheme={onToggleTheme}
        />
        <main className="px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-10">
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

