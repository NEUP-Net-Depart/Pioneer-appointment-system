import { useState } from 'react';
import { Qr } from './ui';

// Only a newly registered customer's own credential is passed here; it is never a staff scan code.
export function CustomerQueueLink({ id, accessToken }: { id: string; accessToken: string }) {
  const [fallback, setFallback] = useState(false),
    [message, setMessage] = useState('');
  const link = new URL('/', location.origin);
  link.hash = new URLSearchParams({ appointment: id, access: accessToken }).toString();
  return (
    <details className="field-details">
      <summary>客户查询码</summary>
      <Qr code={link.href} label="客户私人查询码" />
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link.href);
            setMessage('私人查询链接已复制');
          } catch {
            setFallback(true);
            setMessage('复制失败');
          }
        }}
      >
        复制客户私人查询链接
      </button>
      {fallback && (
        <input
          readOnly
          aria-label="客户私人查询链接"
          value={link.href}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
      <p data-motion-value="text" role="status">
        {message}
      </p>
    </details>
  );
}
