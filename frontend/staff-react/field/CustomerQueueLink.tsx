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
      <summary>让客户在手机上查看排队</summary>
      <p>
        请客户用手机相机扫描，保存自己的查询页面，可查看实时排位或主动退出排队。这是客户私人查询码，请只交给本单机主。
      </p>
      <Qr code={link.href} label="客户私人查询码" />
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link.href);
            setMessage('私人查询链接已复制，请仅交给本单机主');
          } catch {
            setFallback(true);
            setMessage('请复制下方完整链接');
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
      <p role="status">{message}</p>
    </details>
  );
}
