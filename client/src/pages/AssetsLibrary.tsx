import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UploadCloud, Trash2, FileImage, FolderOpen, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, Button, Card, ErrorBox, Loading, SectionTitle } from '../components/ui';
import { toast } from '../store/toast';
import { useProject } from './ProjectLayout';
import { ProtectedVideoPreview } from '../components/ProtectedVideoPreview';

interface AssetRow {
  id: string;
  name: string;
  type: string;
  fileUrl: string;
  thumbnailUrl?: string;
  mimeType: string;
  sizeBytes: number;
  sourceDurationSeconds?: number;
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
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ['assets', project?.id],
    queryFn: () => api.get<AssetRow[]>(`/api/projects/${project!.id}/assets`),
    enabled: Boolean(project?.id),
  });

  // Taste-based asset recommendations (#27): matches uploads against Visual/Motion DNA.
  const { data: tasteRecs } = useQuery({
    queryKey: ['taste', 'recommendations', project?.id],
    queryFn: () =>
      api.get<{
        recommendations: Array<{ id: string; name: string; score: number; matchedOn: string[]; licenseStatus: string }>;
        note: string;
      }>(`/api/taste/recommendations/${project!.id}`),
    enabled: Boolean(project?.id),
    retry: false,
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

  const assets = data || [];
  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    void Promise.all(
      assets
        .filter((asset) => asset.thumbnailUrl && asset.type !== 'video')
        .map(async (asset) => {
          try {
            const blob = await api.getBlob(asset.fileUrl);
            return [asset.id, URL.createObjectURL(blob)] as const;
          } catch {
            return null;
          }
        })
    ).then((results) => {
      if (!active) {
        results.forEach((result) => result && URL.revokeObjectURL(result[1]));
        return;
      }
      const next: Record<string, string> = {};
      results.forEach((result) => {
        if (result) {
          next[result[0]] = result[1];
          urls.push(result[1]);
        }
      });
      setPreviewUrls(next);
    });
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [assets]);

  if (!project) return <Loading />;
  if (isLoading) return <Loading label="Loading assets…" />;
  if (error) return <ErrorBox error={error} />;

  const tasteMatches = tasteRecs?.recommendations.slice(0, 3) ?? [];
  const cleared = assets.filter((a) => a.licenseStatus === 'owned' || a.licenseStatus === 'licensed').length;

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Assets library"
        subtitle="Centralise the files your project can safely use in production."
        action={
          <Button size="sm" onClick={() => fileInput.current?.click()} loading={upload.isPending}>
            <UploadCloud className="h-3.5 w-3.5" /> Upload asset
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <AssetStat label="Total assets" value={String(assets.length)} icon={<FolderOpen className="h-4 w-4" />} />
        <AssetStat label="Rights documented" value={`${cleared}/${assets.length}`} icon={<ShieldCheck className="h-4 w-4" />} tone="success" />
        <AssetStat label="Needs review" value={String(assets.filter((a) => a.licenseStatus !== 'owned' && a.licenseStatus !== 'licensed').length)} icon={<FileImage className="h-4 w-4" />} tone="warning" />
      </div>
      {tasteMatches.length > 0 && (
        <Card className="border-brand-200 bg-brand-50/40 p-4 dark:border-brand-500/25 dark:bg-brand-500/5">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-300">
            Taste-matched for this project
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {tasteMatches.map((a) => (
              <span
                key={a.id}
                className="inline-flex items-center gap-2 rounded-lg border border-brand-200 bg-white px-3 py-1.5 text-xs dark:border-brand-500/30 dark:bg-slate-900"
                title={`Matched on: ${a.matchedOn.join(', ')}`}
              >
                {a.name}
                <Badge tone={LICENSE_TONE[a.licenseStatus] || 'neutral'}>{a.licenseStatus}</Badge>
                <span className="font-semibold tabular-nums text-slate-500">{a.score}%</span>
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">{tasteRecs?.note}</p>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Project files</h2>
          <p className="mt-0.5 text-xs text-slate-500">Upload first, then document rights before final generation.</p>
        </div>
        <Badge tone="neutral">{assets.length} files</Badge>
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
            <Card key={a.id} className="group overflow-hidden transition hover:-translate-y-0.5 hover:border-brand-300 dark:hover:border-brand-700">
              <div className="flex h-36 items-center justify-center bg-slate-100 dark:bg-slate-800">
                {a.type === 'video' && a.fileUrl ? (
                  <ProtectedVideoPreview assetId={a.id} label={a.name} />
                ) : a.thumbnailUrl ? (
                  <img
                    src={previewUrls[a.id]}
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

function AssetStat({ label, value, icon, tone = 'brand' }: { label: string; value: string; icon: React.ReactNode; tone?: 'brand' | 'success' | 'warning' }) {
  const styles = {
    brand: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300',
    success: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
    warning: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  };
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${styles[tone]}`}>{icon}</span>
      <div><p className="text-xl font-semibold tabular-nums">{value}</p><p className="text-xs text-slate-500">{label}</p></div>
    </Card>
  );
}
