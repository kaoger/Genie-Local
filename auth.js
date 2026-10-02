'use strict';
(() => {
/* ================= Supabase 登入與全站成員狀態 ================= */
const { supabaseUrl, supabasePublishableKey } = window.GENIE_CONFIG;
const safeFetch = (input, init = {}) => {
  const headers = new Headers(init.headers);
  const keepalive = headers.get('x-genie-keepalive') === '1';
  headers.delete('x-genie-keepalive');
  if (headers.get('Authorization') === `Bearer ${supabasePublishableKey}`) headers.delete('Authorization');
  return fetch(input, { ...init, headers, ...(keepalive ? { keepalive: true } : {}) });
};
const client = window.supabase.createClient(supabaseUrl, supabasePublishableKey, {
  auth: { detectSessionInUrl: false }, global: { fetch: safeFetch },
});
const verifiedKey = 'genie-verified-member-ids';
const listeners = new Set();
let state = { status: 'checking', displayName: '', email: '', userId: '', localAccess: false };
let generation = 0, denied = false, pending = null, currentSession = null, refreshing = null, memberRefreshing = false;
const getState = () => ({ ...state });
function setState(status, displayName = '', email = '', userId = '', localAccess = false) {
  state = { status, displayName, email, userId, localAccess };
  listeners.forEach(listener => listener(getState()));
}
function subscribe(listener) {
  listeners.add(listener);
  listener(getState());
  return () => listeners.delete(listener);
}
function wasVerified(uid) {
  try { return JSON.parse(localStorage.getItem(verifiedKey) || '[]').includes(uid); } catch { return false; }
}
function rememberVerified(uid) {
  try {
    const ids = JSON.parse(localStorage.getItem(verifiedKey) || '[]');
    localStorage.setItem(verifiedKey, JSON.stringify([...new Set([...ids, uid])]));
  } catch {}
}
function forgetVerified(uid) {
  try {
    const ids = JSON.parse(localStorage.getItem(verifiedKey) || '[]');
    localStorage.setItem(verifiedKey, JSON.stringify(ids.filter(id => id !== uid)));
  } catch {}
}
const offlineError = error => error?.status === 0 || error?.status >= 500 ||
  /fetch|network|連線|timeout|timed out|abort/i.test(error?.message || '');
function setOffline(session) {
  const uid = session.user.id, localAccess = wasVerified(uid);
  setState('offline', state.userId === uid ? state.displayName : '', session.user.email || '', uid, localAccess);
}
async function denyMember(uid) {
  denied = true;
  forgetVerified(uid);
  currentSession = null;
  setState('denied');
  await client.auth.signOut({ scope: 'local' });
  return { error: '此帳號沒有權限，請聯絡管理者' };
}
async function checkMember(session, retried = false) {
  const uid = session?.user?.id;
  if (!uid) { currentSession = null; setState('signedOut'); return { error: null }; }
  currentSession = session;
  if (pending?.uid === uid) return pending.promise;
  const current = ++generation;
  // 已解鎖的工作台在背景複查時維持原畫面與表單。
  if (!(state.status === 'member' && state.userId === uid) &&
      !(state.status === 'offline' && state.userId === uid && state.localAccess)) setState('checking');
  const promise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const { data, error, status } = await client.from('app_admins')
        .select('display_name,active').eq('user_id', uid).abortSignal(controller.signal).maybeSingle();
      if (current !== generation) return { error: null };
      if (error) {
        if (status === 401) {
          if (retried) { setOffline(session); return { error: '無法確認登入，請稍後再試' }; }
          memberRefreshing = true;
          try { const renewed = await refresh(); pending = null; return await checkMember(renewed, true); }
          catch { if (current === generation) setOffline(session); return { error: '無法連線，請稍後再試' }; }
          finally { memberRefreshing = false; }
        }
        if (status >= 400 && status < 500) return denyMember(uid);
        setOffline(session);
        return { error: '無法連線，請稍後再試' };
      }
      if (!data || data.active !== true) return denyMember(uid);
      denied = false;
      rememberVerified(uid);
      setState('member', data.display_name || '', session.user.email || '', uid, true);
      return { error: null };
    } catch {
      if (current === generation) setOffline(session);
      return { error: '無法連線，請稍後再試' };
    } finally { clearTimeout(timeout); }
  })();
  pending = { uid, promise };
  try { return await promise; }
  finally { if (pending?.promise === promise) pending = null; }
}
async function signIn(email, password) {
  denied = false;
  try {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) return { error: offlineError(error) ? '無法連線，請稍後再試' : '帳號或密碼錯誤' };
    return await checkMember(data.session);
  } catch { return { error: '無法連線，請稍後再試' }; }
}
async function expire() {
  denied = false;
  currentSession = null;
  ++generation;
  setState('signedOut');
  await client.auth.signOut({ scope: 'local' });
}
async function refresh() {
  if (refreshing) return refreshing;
  const current = generation;
  refreshing = (async () => {
    const { data, error } = await client.auth.refreshSession();
    if (error || !data?.session) {
      if (error?.status >= 400 && error.status < 500 && ![408,429].includes(error.status)) {
        if (current === generation) await expire();
      }
      throw Error('續期失敗');
    }
    return data.session;
  })();
  try { return await refreshing; } finally { refreshing = null; }
}
async function signOut({ exported = false } = {}) {
  if (window.GenieSync && (state.status === 'member' || state.status === 'offline')) {
    const count = exported ? 0 : await window.GenieSync.prepareSignOut();
    if (count) return { pending: count };
    try { window.GenieSync.clear(); } catch { return { error: '這台裝置無法清除快取，請確認瀏覽器儲存權限' }; }
  }
  await expire();
  return { pending: 0 };
}
function retry() {
  if (state.status !== 'offline' || !currentSession) return;
  return checkMember(currentSession);
}
client.auth.onAuthStateChange((event, session) => {
  if (!session) {
    ++generation;
    currentSession = null;
    setState(denied ? 'denied' : 'signedOut');
    return;
  }
  if (memberRefreshing) return;
  queueMicrotask(() => { checkMember(session); });
});
window.addEventListener('online', retry);
document.addEventListener('visibilitychange', () => { if (!document.hidden) retry(); });
window.GenieAuth = { getState, subscribe, signIn, signOut, retry, refresh, expire, recheck:()=>currentSession?checkMember(currentSession):null, getClient: () => client };
})();
