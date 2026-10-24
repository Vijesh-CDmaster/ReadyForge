import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from '../store/toast';
import { Badge, Button, Card, ErrorBox, Field, Loading, SectionTitle, Textarea } from '../components/ui';

interface ContractPayload {
  contract: {
    id: string;
    version: number;
    status: string;
    contentPlan: { outline: string[]; script: string };
  } | null;
}

/**
 * Script Editor — the rung's text lives in the Production Contract's content plan.
 * Edits here are saved back through the plan endpoint and are audit-logged server-side.
 */
export default function ScriptEditor() {
  const { projectId = '' } = useParams();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['contract', projectId],
    queryFn: () => api.get<ContractPayload>(`/api/projects/${projectId}/contract`),
    enabled: Boolean(projectId),
  });

  const [script, setScript] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data?.contract) {
      setScript(data.contract.contentPlan.script || '');
      setDirty(false);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => api.patch(`/api/projects/${projectId}/plan`, { script }),
    onSuccess: () => {
      toast.success('Script saved to the Production Contract');
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['contract', projectId] });
      queryClient.invalidateQueries({ queryKey: ['ladder', projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <Loading label="Loading script…" />;
  if (error) return <ErrorBox error={error} />;
  if (!data?.contract) {
    return (
      <Card>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          No Production Contract yet — create it first, then generate the script rung on the Draft Ladder.
        </p>
      </Card>
    );
  }

  const beats = data.contract.contentPlan.outline || [];

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Script Editor"
        subtitle={`Contract v${data.contract.version} · ${data.contract.status}. Manual edits are audit-logged; regeneration on the ladder overwrites the script.`}
      />

      <div className="flex items-center gap-2">
        {dirty ? (
          <Badge tone="warning">Unsaved changes</Badge>
        ) : (
          <Badge tone="neutral">Saved in contract</Badge>
        )}
        <span className="text-xs text-slate-500">{script.length} characters</span>
        <div className="ml-auto flex gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
          >
            <Save className="mr-1 h-3.5 w-3.5" />
            {save.isPending ? 'Saving…' : 'Save script'}
          </Button>
        </div>
      </div>

      {beats.length > 0 && (
        <Card>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Outline beats</p>
          <ol className="list-inside list-decimal space-y-1 text-sm text-slate-600 dark:text-slate-300">
            {beats.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ol>
        </Card>
      )}

      <Field label="Script" hint="Blocks separated by blank lines: [SCENE n — beat], VISUAL:, VO:, DURATION:">
        <Textarea
          rows={24}
          value={script}
          onChange={(e) => {
            setScript(e.target.value);
            setDirty(true);
          }}
          placeholder="Generate the script on the Draft Ladder, or write it here."
          className="font-mono text-xs"
        />
      </Field>
    </div>
  );
}