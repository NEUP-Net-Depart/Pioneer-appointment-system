import type { StaffProfileDto } from '../../shared/staff-types.ts';
import { failureFrom } from '../../shared/api-types.ts';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiJson, clearSession, useStaffSession } from '../../shared/api.ts';
import { showToast } from '../../shared/utils.ts';
import { identifyTelemetry, resetTelemetry } from '../../shared/telemetry-client.ts';

useStaffSession();

export function useStaffIdentity() {
  const client = useQueryClient();
  const [token, setToken] = useState(() => sessionStorage.getItem('pioneerToken'));
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef<AbortController | null>(null);
  const profile = useQuery({
    queryKey: ['/api/auth/me', token],
    queryFn: ({ signal }) => apiJson<StaffProfileDto>('/api/auth/me', { signal, timeoutMs: 15000 }),
    enabled: !!token
  });
  function reset(message = '') {
    attempt.current?.abort();
    client.clear();
    clearSession();
    resetTelemetry();
    sessionStorage.removeItem('field-campus');
    setToken(null);
    setSigningIn(false);
    setError(message);
  }
  useEffect(() => {
    const expired = (event: Event) =>
      reset(
        (event as CustomEvent<{ message?: string }>).detail?.message || '登录已过期，请重新登录'
      );
    window.addEventListener('auth-expired', expired);
    return () => {
      attempt.current?.abort();
      window.removeEventListener('auth-expired', expired);
    };
  }, []);
  useEffect(() => {
    if (!profile.data || token !== sessionStorage.getItem('pioneerToken')) return;
    const user = profile.data;
    identifyTelemetry(user);
    sessionStorage.setItem('pioneerRole', user.role);
    sessionStorage.setItem('pioneerAccount', user.account);
    sessionStorage.setItem('pioneerMemberId', user.memberId || user.actor?.memberId || '');
    sessionStorage.setItem('pioneerCampuses', JSON.stringify(user.authorizedCampuses));
  }, [profile.data, token]);
  async function login(account: string, password: string) {
    reset();
    setSigningIn(true);
    const controller = new AbortController();
    attempt.current = controller;
    try {
      const payload = await apiJson<{ token: string }>('/api/auth/login', {
        method: 'POST',
        json: { account: account.trim(), password },
        signal: controller.signal
      });
      if (controller.signal.aborted) return;
      sessionStorage.setItem('pioneerToken', payload.token);
      setToken(payload.token);
      showToast('登录成功');
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(failureFrom(failure).message || '无法连接服务器，请稍后重试');
    } finally {
      if (!controller.signal.aborted) setSigningIn(false);
    }
  }
  async function logout() {
    const revoke = apiJson('/api/auth/logout', { method: 'POST', suppressAuthExpired: true });
    reset();
    try {
      await revoke;
    } catch (failure) {
      if (failureFrom(failure).status !== 401) showToast('网络异常，服务器会话未撤销；本机已退出');
    }
  }
  return {
    user: token ? profile.data : null,
    hasSession: !!token,
    pending: signingIn || (!!token && profile.isPending),
    error: error || profile.error?.message || '',
    login,
    logout,
    retry: () => profile.refetch()
  };
}
