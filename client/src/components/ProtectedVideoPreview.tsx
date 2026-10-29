import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function ProtectedVideoPreview({ assetId, label }: { assetId: string; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState('Loading protected video…');

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setUrl(null);
    setMessage('Loading protected video…');
    void api
      .getBlob(`/api/assets/${encodeURIComponent(assetId)}/file`)
      .then((blob) => {
        if (!active) return;
        if (blob.type && blob.type !== 'video/mp4' && !blob.type.startsWith('video/')) {
          setMessage('This asset is not a playable video.');
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setMessage('The protected video could not be loaded.');
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId]);

  if (!url) return <p className="p-3 text-xs text-slate-500">{message}</p>;
  return (
    <video
      src={url}
      controls
      preload="metadata"
      className="max-h-56 w-full bg-black"
      aria-label={label}
      onError={() => {
        setUrl(null);
        setMessage('This asset is not a playable video.');
        URL.revokeObjectURL(url);
      }}
    />
  );
}
