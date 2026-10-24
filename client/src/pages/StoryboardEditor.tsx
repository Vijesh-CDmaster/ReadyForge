import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from '../store/toast';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Loading,
  SectionTitle,
  Textarea,
} from '../components/ui';

interface Scene {
  sceneNumber: number;
  title: string;
  description: string;
  visualDirection: string;
  voiceover: string;
  durationSeconds: number;
  status: string;
}

interface ContractPayload {
  contract: {
    id: string;
    version: number;
    status: string;
    contentPlan: { outline: string[]; script: string; storyboard: Scene[] };
  } | null;
}

/**
 * Storyboard Editor — scenes live in the Production Contract's content plan.
 * Saving marks every scene back to draft so it flows through review again.
 */
export default function StoryboardEditor() {
  const { projectId = '' } = useParams();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['contract', projectId],
    queryFn: () => api.get<ContractPayload>(`/api/projects/${projectId}/contract`),
    enabled: Boolean(projectId),
  });

  const [scenes, setScenes] = useState<Scene[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data?.contract) {
      setScenes(data.contract.contentPlan.storyboard || []);
      setDirty(false);
    }
  }, [data]);

  const update = (idx: number, patch: Partial<Scene>) => {
    setScenes((s) => s.map((sc, i) => (i === idx ? { ...sc, ...patch } : sc)));
    setDirty(true);
  };

  const addScene = () => {
    setScenes((s) => [
      ...s,
      {
        sceneNumber: s.length + 1,
        title: `Scene ${s.length + 1}`,
        description: '',
        visualDirection: '',
        voiceover: '',
        durationSeconds: 5,
        status: 'draft',
      },
    ]);
    setDirty(true);
  };

  const removeScene = (idx: number) => {
    setScenes((s) => s.filter((_, i) => i !== idx).map((sc, i) => ({ ...sc, sceneNumber: i + 1 })));
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: () => api.patch(`/api/projects/${projectId}/plan`, { storyboard: scenes }),
    onSuccess: () => {
      toast.success('Storyboard saved to the Production Contract');
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['contract', projectId] });
      queryClient.invalidateQueries({ queryKey: ['ladder', projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <Loading label="Loading storyboard…" />;
  if (error) return <ErrorBox error={error} />;
  if (!data?.contract) {
    return (
      <Card>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          No Production Contract yet — create it first, then generate the storyboard rung on the Draft Ladder.
        </p>
      </Card>
    );
  }

  const total = scenes.reduce((sum, s) => sum + (Number(s.durationSeconds) || 0), 0);

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Storyboard Editor"
        subtitle={`Contract v${data.contract.version} · ${scenes.length} scenes · ${total}s total. Saving marks scenes as draft so they flow through review again.`}
        action={
          <div className="flex items-center gap-2">
            {dirty ? <Badge tone="warning">Unsaved changes</Badge> : <Badge tone="neutral">Saved</Badge>}
            <Button variant="secondary" size="sm" onClick={addScene}>
              + Scene
            </Button>
            <Button variant="primary" size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              <Save className="mr-1 h-3.5 w-3.5" />
              {save.isPending ? 'Saving…' : 'Save storyboard'}
            </Button>
          </div>
        }
      />

      {scenes.length === 0 ? (
        <EmptyState
          title="No scenes yet"
          description="Generate the storyboard rung on the Draft Ladder, or add scenes manually."
          action={
            <Button variant="primary" onClick={addScene}>
              Add first scene
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {scenes.map((scene, idx) => (
            <Card key={idx} className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                    {scene.sceneNumber}
                  </span>
                  <Input
                    value={scene.title}
                    onChange={(e) => update(idx, { title: e.target.value })}
                    className="h-8 w-44 text-sm"
                    aria-label="Scene title"
                  />
                  <Badge tone="neutral">{scene.durationSeconds}s</Badge>
                  <Badge
                    tone={
                      scene.status === 'approved' ? 'success' : scene.status === 'failed' ? 'danger' : 'neutral'
                    }
                  >
                    {scene.status}
                  </Badge>
                </div>
                <button
                  className="rounded p-1 text-slate-400 hover:text-red-500"
                  onClick={() => removeScene(idx)}
                  aria-label="Remove scene"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <Field label="Description">
                <Textarea
                  rows={2}
                  value={scene.description}
                  onChange={(e) => update(idx, { description: e.target.value })}
                  placeholder="What happens in this scene"
                />
              </Field>
              <Field label="Visual direction">
                <Textarea
                  rows={2}
                  value={scene.visualDirection}
                  onChange={(e) => update(idx, { visualDirection: e.target.value })}
                  placeholder="Shot, style, on-screen text, captions…"
                />
              </Field>
              <div className="grid grid-cols-[1fr_110px] gap-3">
                <Field label="Voiceover">
                  <Input
                    value={scene.voiceover}
                    onChange={(e) => update(idx, { voiceover: e.target.value })}
                    placeholder="Spoken line"
                  />
                </Field>
                <Field label="Seconds">
                  <Input
                    type="number"
                    min={0}
                    value={scene.durationSeconds}
                    onChange={(e) => update(idx, { durationSeconds: Number(e.target.value) })}
                  />
                </Field>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}