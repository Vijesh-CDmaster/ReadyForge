import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Inbox } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, Button, Card, ErrorBox, Loading, SectionTitle, cx } from '../components/ui';
import { toast } from '../store/toast';

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  link?: string;
  projectId: string | null;
  createdAt: string;
}

export default function NotificationsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api.get<{ notifications: NotificationRow[]; unread: number }>('/api/notifications'),
    refetchInterval: 30_000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.patch(`/api/notifications/${id}/read`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (err) => toast.error(err.message),
  });

  const markAll = useMutation({
    mutationFn: () => api.patch('/api/notifications/read-all'),
    onSuccess: () => {
      toast.success('All notifications marked as read');
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const items = data?.notifications || [];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionTitle
        title="Notifications"
        subtitle="Approval requests, assignments, generation results, and workspace activity."
        action={
          <div className="flex items-center gap-2">
            {(data?.unread ?? 0) > 0 && <Badge tone="danger">{data!.unread} unread</Badge>}
            <Button variant="outline" size="sm" onClick={() => markAll.mutate()} loading={markAll.isPending}>
          <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </Button>
          </div>
        }
      />

      {items.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-14 text-center">
          <Inbox className="mb-3 h-8 w-8 text-slate-400" />
          <p className="text-sm font-semibold">No notifications</p>
          <p className="mt-1 text-sm text-slate-500">
            Conflict assignments, approval requests and generation results appear here.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <Card
              key={n.id}
              className={cx('p-4 transition', !n.isRead && 'border-brand-200 bg-brand-50/50 dark:border-brand-800 dark:bg-brand-500/5')}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">{n.type.replace(/_/g, ' ')}</Badge>
                    {!n.isRead && <Badge tone="brand">new</Badge>}
                  </div>
                  <p className="mt-1.5 text-sm font-medium">{n.title}</p>
                  {n.message && <p className="mt-0.5 text-sm text-slate-500">{n.message}</p>}
                  <div className="mt-2 flex items-center gap-3">
                    <span className="text-xs text-slate-400">{new Date(n.createdAt).toLocaleString()}</span>
                    {n.link && (
                      <Link
                        to={n.link}
                        onClick={() => !n.isRead && markRead.mutate(n.id)}
                        className="text-xs font-medium text-brand-600 hover:underline"
                      >
                        Open →
                      </Link>
                    )}
                    {!n.isRead && (
                      <button
                        onClick={() => markRead.mutate(n.id)}
                        className="text-xs text-slate-500 underline hover:text-slate-700"
                      >
                        mark read
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
