import { ChevronRight, Home } from 'lucide-react';
import { getBreadcrumbs } from '../../lib/folders';

interface Props {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export function Breadcrumb({ currentPath, onNavigate }: Props) {
  const crumbs = getBreadcrumbs(currentPath);

  return (
    <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label="Breadcrumb">
      <button
        onClick={() => onNavigate('')}
        className="flex items-center gap-1 rounded px-2 py-1 text-gray-600 transition-colors hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
      >
        <Home size={14} />
        <span>Root</span>
      </button>
      {crumbs.map((crumb) => (
        <span key={crumb.path} className="flex items-center gap-1">
          <ChevronRight size={14} className="text-gray-400 dark:text-gray-500" />
          <button
            onClick={() => onNavigate(crumb.path)}
            className="rounded px-2 py-1 text-gray-600 transition-colors hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {crumb.name}
          </button>
        </span>
      ))}
    </nav>
  );
}
