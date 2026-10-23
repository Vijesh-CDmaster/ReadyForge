import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UploadCloud, Trash2, FileImage } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, Button, Card, ErrorBox, Loading } from '../components/ui';
import { toast } from '../store/toast';
import { useProject } from './ProjectLayout';

interface AssetRow {
  id: string;
  name: string;
  type: string;
  fileUrl: string;
  thumbnailUrl?: string;
  mimeType: string;
  sizeBytes: number;
  licenseStatus: 'owned' | 'licensed' | 'unknown' | 'restricted' | 'expired';
  aiGenerated: boolean;
  consentStatus: string;
  createdAt: string;
}

const LICENSE_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  owned: 'success',
  licensed: 'success',
  unknown: 'warning',
  restricted: 'danger',
  expired: 'danger',
};

export default function AssetsLibrary() {
  const { data: project } = useProject();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['assets', project?.id],
    queryFn: () => api.get<AssetRow[]>(`/api/projects/${project!.id}/assets`),
    enabled: Boolean(project?.id),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['assets', project?.id] });
    void queryClient.invalidateQueries({ queryKey: ['readiness', project?.id] });
    void queryClient.invalidateQueries({ queryKey: ['cost-at-risk', project?.id] });
  };

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      form.append('projectId', project!.id);
      return api.post<{ asset: AssetRow }>('/api/assets/upload', form);
    },
    onSuccess: () => {
      toast.success('Uploaded — licence status defaults to “unknown” until documented');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/assets/${id}`),
    onSuccess: () => {
      toast.success('Asset deleted');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (!project) return <Loading />;
  if (isLoading) return <Loading label="Loading assets…" />;
  if (error) return <ErrorBox error={error} />;

  const assets = data || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">Assets Library</h2>
          <Badge tone="neutral">{assets.length} files</Badge>
        </div>
        <Button size="sm" onClick={() => fileInput.current?.click()} loading={upload.isPending}>
          <UploadCloud className="h-3.5 w-3.5" /> Upload
        </Button>
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          accept="image/*,video/mp4,video/webm,audio/*,.pdf,.txt,.woff,.woff2,.ttf"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = '';
          }}
        />
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) upload.mutate(file);
        }}
        className={`rounded-xl border-2 border-dashed px-6 py-8 text-center transition ${
          dragging ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10' : 'border-slate-300 dark:border-slate-700'
        }`}
      >
        <UploadCloud className="mx-auto h-6 w-6 text-slate-400" />
        <p className="mt-2 text-sm text-slate-500">
          Drop files here or click Upload — images, video, audio, fonts and documents up to 25&nbsp;MB.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          File types are validated server-side; every upload is audit-logged.
        </p>
      </div>

      {assets.length === 0 ? (
        <Card className="px-6 py-12 text-center">
          <FileImage className="mx-auto h-8 w-8 text-slate-400" />
          <p className="mt-2 text-sm font-semibold">No assets yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Upload your logo, product images and music — then record licences in Rights &amp; Licence Manager.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map((a) => (
            <Card key={a.id} className="overflow-hidden">
              <div className="flex h-32 items-center justify-center bg-slate-100 dark:bg-slate-800">
                {a.thumbnailUrl ? (
                  <img
                    src={a.fileUrl}
                    alt={a.name}
                    className="max-h-32 w-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <span className="text-4xl text-slate-400">🎵</span>
                )}
              </div>
              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-sm font-medium" title={a.name}>{a.name}</p>
                  <button onClick={() => confirm(`Delete ${a.name}?`) && remove.mutate(a.id)} aria-label="Delete">
                    <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge tone={LICENSE_TONE[a.licenseStatus]}>{a.licenseStatus}</Badge>
                  <Badge tone="neutral">{a.type}</Badge>
                  {a.aiGenerated && <Badge tone="brand">AI-generated</Badge>}
                  <span className="text-[10px] text-slate-400">{Math.round(a.sizeBytes / 1024)} KB</span>
                </div>
                <a
                  href={`/app/projects/${project.id}/rights`}
                  className="mt-2 inline-block text-xs font-medium text-brand-600 hover:underline"
                >
                  Manage licence →
                </a>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
