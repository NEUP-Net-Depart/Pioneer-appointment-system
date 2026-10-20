import { useEffect, useRef, useState } from 'react';
import { apiJson, clearSession, useStaffSession } from '../../shared/api.js';
import { showToast } from '../../shared/utils.js';
import { clearWorkspaceState } from './workspace-state.js';

useStaffSession();

// React owns the session. Every asynchronous result is bound to the token and
// generation that started it, including login, restoration and revalidation.
export function useStaffIdentity() {
  const [user, setUser] = useState(null);
  const [hasSession, setHasSession] = useState(!!sessionStorage.getItem('pioneerToken'));
  const [pending, setPending] = useState(!!sessionStorage.getItem('pioneerToken'));
  const [error, setError] = useState('');
  const generation = useRef(0),
    request = useRef(null);
  function reset(message = '') {
    generation.current++;
    request.current?.abort();
    clearSession();
    clearWorkspaceState();
    setHasSession(false);
    setUser(null);
    setPending(false);
    setError(message);
  }
  async function refresh() {
    const token = sessionStorage.getItem('pioneerToken'),
      version = generation.current;
    if (!token) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const profile = await apiJson('/api/auth/me', { signal: controller.signal });
      if (
        controller.signal.aborted ||
        version !== generation.current ||
        token !== sessionStorage.getItem('pioneerToken')
      )
        return;
      sessionStorage.setItem('pioneerRole', profile.role);
      sessionStorage.setItem('pioneerAccount', profile.account);
      sessionStorage.setItem('pioneerMemberId', profile.memberId || profile.actor?.memberId || '');
      sessionStorage.setItem('pioneerCampuses', JSON.stringify(profile.authorizedCampuses));
      setUser(profile);
      setError('');
    } catch (failure) {
      if (!controller.signal.aborted && version === generation.current)
        setError(failure.message || '会话验证失败，请稍后重试');
    } finally {
      if (!controller.signal.aborted && version === generation.current) setPending(false);
    }
  }
  useEffect(() => {
    const expired = (event) => reset(event.detail?.message || '登录已过期，请重新登录');
    window.addEventListener('auth-expired', expired);
    const revalidate = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', revalidate);
    const timer = setInterval(revalidate, 30000);
    refresh();
    return () => {
      generation.current++;
      request.current?.abort();
      clearInterval(timer);
      window.removeEventListener('auth-expired', expired);
      document.removeEventListener('visibilitychange', revalidate);
    };
  }, []);
  async function login(account, password) {
    reset();
    setPending(true);
    const version = generation.current;
    const controller = new AbortController();
    request.current = controller;
    try {
      const payload = await apiJson('/api/auth/login', {
        method: 'POST',
        json: { account: account.trim(), password },
        signal: controller.signal
      });
      if (version !== generation.current || controller.signal.aborted) return;
      sessionStorage.setItem('pioneerToken', payload.token);
      setHasSession(true);
      await refresh();
      if (version === generation.current && sessionStorage.getItem('pioneerToken'))
        showToast('登录成功');
    } catch (failure) {
      if (!controller.signal.aborted && version === generation.current)
        setError(failure.message || '无法连接服务器，请稍后重试');
    } finally {
      if (version === generation.current) setPending(false);
    }
  }
  async function logout() {
    const revoke = apiJson('/api/auth/logout', { method: 'POST', suppressAuthExpired: true });
    reset();
    try {
      await revoke;
    } catch (failure) {
      if (failure.status !== 401) showToast('网络异常，服务器会话未撤销；本机已退出');
    }
  }
  return { user, hasSession, pending, error, login, logout, retry: refresh };
}
