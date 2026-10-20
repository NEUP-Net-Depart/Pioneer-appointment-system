import React, { useEffect, useState } from 'react';
import { request } from './request.js';
import { showToast } from '../../shared/utils.js';

function Brand({ activation = false }) {
  return <div className="login-brand"><img className="organization-logo" src="/assets/organization-logo.jpg" alt="先锋网络中心 Logo" /><div><strong>先锋硬件部</strong><small>{activation ? '工作人员首次激活' : '免费维修预约系统'}</small></div></div>;
}
function LengthInput({ maxLength, ...props }) {
  const [invalid, setInvalid] = useState(false);
  const errorId = `length-error-${props.id}`;
  const message = `必须在 ${maxLength} 字以内`;
  const validate = event => {
    if (event.nativeEvent.isComposing) return;
    const overflow = event.currentTarget.value.length > maxLength;
    event.currentTarget.setCustomValidity(overflow ? message : '');
    setInvalid(overflow);
  };
  // Preserve the former activation form's full pasted value and inline error.
  // React owns the feedback; native validity keeps focus on the first error.
  return <><input {...props} data-max-length={maxLength} aria-describedby={errorId} aria-invalid={invalid || undefined} onInput={validate} onCompositionEnd={validate} /><span className="input-length-error" id={errorId} role="alert" hidden={!invalid}>{invalid ? message : ''}</span></>;
}
export function StaffLogin({ pending, error, onLogin, onRetry }) {
  return <section className="login-view" id="login-view"><div className="login-panel"><Brand /><p className="eyebrow">STAFF ACCESS · ACCOUNT LOGIN</p><h1>工作人员登录</h1>
    <form className="login-form" id="login-form" onSubmit={async event => {
      event.preventDefault(); const form = event.currentTarget, fields = new FormData(form);
      await onLogin(fields.get('account'), fields.get('password'));
      form.elements.namedItem('password').value = '';
    }}><label>学号 <i>*</i><input aria-label="学号" id="login-id" name="account" required placeholder="请输入学号" autoComplete="username" /></label><label>密码 <i>*</i><input aria-label="密码" id="login-password" name="password" type="password" required placeholder="请输入密码" autoComplete="current-password" /></label><button className="primary-btn" type="submit" disabled={pending}>进入系统 <span>→</span></button></form>
    <p className="login-message" id="login-message" role="status" aria-live="polite" hidden={!error}>{error}</p>
    {error && sessionStorage.getItem('pioneerToken') && <button className="secondary-btn" onClick={onRetry}>重新加载工作区</button>}
    <div className="login-links"><a className="secondary-btn" href="/staff/?activate=1">部员首次激活</a><a className="text-btn register-cancel" href="/">返回用户预约</a></div></div></section>;
}

const receiptKey = 'pioneerActivationReceipt';
export function StaffActivation() {
  const [receipt, setReceipt] = useState(() => { try { return JSON.parse(localStorage.getItem(receiptKey) || 'null'); } catch { return null; } });
  const [result, setResult] = useState(null), [busy, setBusy] = useState(false);
  const labels = { pending: '申请已提交，等待管理员核验身份', approved: '审核已通过，可以使用学号和自行设置的密码登录', rejected: '申请未通过，可核实资料后重新申请' };
  async function refresh(signal) {
    if (!receipt) return;
    try { const item = await request(`/api/activation/${encodeURIComponent(receipt.id)}`, { headers: { 'X-Activation-Receipt': receipt.receipt }, signal }); if (!signal?.aborted) setResult(item); }
    catch (error) { if (!signal?.aborted) showToast(error.message); }
  }
  useEffect(() => { const controller = new AbortController(); refresh(controller.signal); return () => controller.abort(); }, [receipt?.id]);
  async function submit(event) {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form);
    if (data.get('password') !== data.get('confirm')) { showToast('两次密码不一致'); return; }
    setBusy(true);
    try {
      const item = await request('/api/activation', { method: 'POST', body: { studentId: data.get('studentId').trim(), name: data.get('name').trim(), homeCampus: data.get('homeCampus'), password: data.get('password') } });
      const next = { id: item.id, receipt: item.receipt }; setReceipt(next); setResult(item);
      try { localStorage.setItem(receiptKey, JSON.stringify(next)); } catch { showToast('申请已提交，浏览器无法保存回执，请联系管理员了解审核进度'); }
      form.reset();
    } catch (error) { showToast(error.message); } finally { setBusy(false); }
  }
  return <section className="login-view" id="activation-view"><div className="login-panel"><Brand activation /><p className="eyebrow">STAFF ACTIVATION</p><form id="activation-form" className="login-form" onSubmit={submit} hidden={!!result && result.status !== 'rejected'}>
    <label>学号<LengthInput id="activation-student-id" name="studentId" inputMode="numeric" pattern="[0-9]{6,20}" maxLength={20} required autoComplete="username" /></label><label>姓名<LengthInput id="activation-name" name="name" minLength={2} maxLength={80} required autoComplete="name" /></label><label>所属校区<select id="activation-campus" name="homeCampus" required><option value="">请选择所属校区</option><option>南湖</option><option>浑南</option></select></label><label>设置密码<LengthInput id="activation-password" name="password" type="password" minLength={8} maxLength={128} required autoComplete="new-password" /></label><label>确认密码<LengthInput id="activation-confirm" name="confirm" type="password" minLength={8} maxLength={128} required autoComplete="new-password" /></label><button className="primary-btn" type="submit" disabled={busy}>提交激活申请</button></form>
    {result && <div id="activation-result"><h2 id="activation-status" role="status">{labels[result.status]}</h2><p id="activation-note" hidden={!result.reviewNote}>{result.reviewNote}</p><button id="refresh-activation" className="secondary-btn" type="button" onClick={() => refresh()}>刷新审核结果</button><a id="activation-login" className="primary-btn" href="/staff/" hidden={result.status !== 'approved'}>前往登录</a></div>}<a className="text-btn" href="/staff/">返回工作人员登录</a></div></section>;
}
