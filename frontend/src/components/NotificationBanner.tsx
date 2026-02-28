import { AlertTriangle, CheckCircle } from 'lucide-react';

export interface Notification {
  type: 'error' | 'warning' | 'success' | 'info';
  message: string;
}

interface Props {
  notification: Notification | null;
  onDismiss: () => void;
}

export function NotificationBanner({ notification, onDismiss }: Props) {
  if (!notification) return null;

  const colors = {
    error: 'bg-red-100 border-red-400 text-red-700',
    warning: 'bg-yellow-100 border-yellow-400 text-yellow-700',
    success: 'bg-green-100 border-green-400 text-green-700',
    info: 'bg-blue-100 border-blue-400 text-blue-700',
  };

  const icons = {
    error: <AlertTriangle size={18} />,
    warning: <AlertTriangle size={18} />,
    success: <CheckCircle size={18} />,
    info: <CheckCircle size={18} />,
  };

  return (
    <div className={`fixed top-8 right-4 left-4 z-50 flex items-start gap-3 rounded-lg border p-4 shadow-lg md:left-auto md:w-96 ${colors[notification.type]}`}>
      {icons[notification.type]}
      <div className="flex-1 text-sm">{notification.message}</div>
      <button onClick={onDismiss} className="text-current opacity-50 hover:opacity-100">
        ✕
      </button>
    </div>
  );
}
