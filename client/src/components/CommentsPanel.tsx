import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Trash2, Send } from 'lucide-react';
import { api } from '../lib/api';
import { Avatar, Button, EmptyState, ErrorBox, Loading, Textarea, cx } from './ui';
import { toast } from '../store/toast';
import { useAuthStore } from '../store/auth';

interface CommentRow {
  id: string;
  authorId: string;
  author: string;
  authorEmail: string;
  body: string;
  parentId: string | null;
  mentionUserIds: string[];
  createdAt: string;
}

/**
 * Threaded comments (spec §22.3) for any entity: conflict, contract, project or task.
 * Type @name or @email-localpart to mention a teammate — mentions notify them
 * server-side, respecting their notification preferences.
 */
export function CommentsPanel({
  entityType,
  entityId,
  title = 'Comments',
}: {
  entityType: 'conflict' | 'contract' | 'project' | 'task';
  entityId: string;
  title?: string;
}) {
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);

  const key = ['comments', entityType, entityId];
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ comments: CommentRow[] }>(`/api/comments/${entityType}/${entityId}`),
    enabled: Boolean(entityId),
    retry: false,
  });

  const post = useMutation({
    mutationFn: (payload: { body: string; parentId?: string }) =>
      api.post<{ comment: CommentRow; mentioned: string[] }>(
        `/api/comments/${entityType}/${entityId}`,
        payload
      ),
    onSuccess: (r) => {
      setBody('');
      setReplyTo(null);
      void queryClient.invalidateQueries({ queryKey: key });
      if (r.mentioned.length) toast.info(`Mentioned ${r.mentioned.join(', ')}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/comments/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
    onError: (e: Error) => toast.error(e.message),
  });

  const comments = data?.comments ?? [];
  const roots = comments.filter((c) => !c.parentId);
  const repliesOf = (id: string) => comments.filter((c) => c.parentId === id);

  const renderBody = (c: CommentRow) =>
    c.body.split(/(@[\w.-]+)/g).map((part, i) =>
      part.startsWith('@') ? (
        <span key={i} className="font-medium text-brand-600 dark:text-brand-300">
          {part}
        </span>
      ) : (
        <span key={i}>{part}</span>
      )
    );

  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <MessageSquare className="h-4 w-4 text-slate-400" aria-hidden /> {title}
        </h3>
        <span className="text-xs text-slate-400">{comments.length} message{comments.length === 1 ? '' : 's'}</span>
      </div>

      {isLoading && <Loading label="Loading comments…" />}
      {error && <ErrorBox error={error} className="mb-3" />}
      {!isLoading && !roots.length && (
        <EmptyState
          icon={<MessageSquare className="h-8 w-8" />}
          title="No comments yet"
          description="Start the discussion — use @name to notify a teammate."
        />
      )}

      <ul className="space-y-3">
        {roots.map((c) => (
          <li key={c.id} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
            <div className="flex items-start gap-2.5">
              <Avatar name={c.author} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium">{c.author}</span>
                  <span className="text-[11px] text-slate-400">
                    {new Date(c.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">
                  {renderBody(c)}
                </p>
                <div className="mt-1.5 flex gap-3 text-xs">
                  <button
                    className="text-slate-500 hover:text-brand-600"
                    onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}
                  >
                    Reply
                  </button>
                  {(me?.id === c.authorId || me?.platformRole === 'admin') && (
                    <button
                      className="flex items-center gap-1 text-slate-500 hover:text-rose-600"
                      onClick={() => remove.mutate(c.id)}
                    >
                      <Trash2 className="h-3 w-3" aria-hidden /> Delete
                    </button>
                  )}
                </div>

                {repliesOf(c.id).length > 0 && (
                  <ul className="mt-2 space-y-2 border-l border-slate-200 pl-3 dark:border-slate-700">
                    {repliesOf(c.id).map((r) => (
                      <li key={r.id}>
                        <div className="flex items-baseline gap-2">
                          <span className="text-xs font-semibold">{r.author}</span>
                          <span className="text-[10px] text-slate-400">
                            {new Date(r.createdAt).toLocaleString()}
                          </span>
                          {(me?.id === r.authorId || me?.platformRole === 'admin') && (
                            <button
                              className="text-[10px] text-slate-400 hover:text-rose-600"
                              onClick={() => remove.mutate(r.id)}
                              aria-label={`Delete comment by ${r.author}`}
                            >
                              <Trash2 className="h-3 w-3" aria-hidden />
                            </button>
                          )}
                        </div>
                        <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">
                          {renderBody(r)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}

                {replyTo === c.id && (
                  <div className="mt-2">
                    <Textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder={`Reply to ${c.author}… use @name to mention`}
                      className="min-h-[64px] text-sm"
                      aria-label={`Reply to ${c.author}`}
                      autoFocus
                    />
                    <div className="mt-1.5 flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => { setReplyTo(null); setBody(''); }}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        loading={post.isPending}
                        disabled={!body.trim()}
                        onClick={() => post.mutate({ body: body.trim(), parentId: c.id })}
                      >
                        <Send className="h-3.5 w-3.5" aria-hidden /> Reply
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {!replyTo && (
        <div className={cx('mt-4 border-t border-slate-100 pt-3 dark:border-slate-800')}>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a comment — type @name or @email to mention a teammate…"
            className="min-h-[72px] text-sm"
            aria-label="Add a comment"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-slate-400">
              Mentions notify the mentioned teammate (if enabled in their preferences).
            </span>
            <Button
              size="sm"
              loading={post.isPending}
              disabled={!body.trim()}
              onClick={() => post.mutate({ body: body.trim() })}
            >
              <Send className="h-3.5 w-3.5" aria-hidden /> Comment
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
