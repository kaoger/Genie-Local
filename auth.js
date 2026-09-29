'use strict';
(() => {
/* ================= Supabase 登入與全站成員狀態 ================= */
const { supabaseUrl, supabasePublishableKey } = window.GENIE_CONFIG;
const safeFetch = (input, init = {}) => {
  const headers = new Headers(init.headers);
  if (headers.get('Authorization') === `Bearer ${supabasePublishableKey}`) headers.delete('Authorization');
  return fetch(input, { ...init, headers });
};
const client = window.supabase.createClient(supabaseUrl, supabasePublishableKey, {
  auth: { detectSessionInUrl: false }, global: { fetch: safeFetch },
});
const verifiedKey = 'genie-verified-member-ids';
const listeners = new Set();
let state = { status: 'checking', displayName: '', email: '', userId: '', localAccess: false };
let generation = 0, denied = false, pending = null, currentSession = null;
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
async function checkMember(session) {
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
          await signOut();
          return { error: '登入已失效，請重新登入' };
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
async function signOut() {
  denied = false;
  currentSession = null;
  ++generation;
  setState('signedOut');
  await client.auth.signOut({ scope: 'local' });
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
  queueMicrotask(() => { checkMember(session); });
});
window.addEventListener('online', retry);
document.addEventListener('visibilitychange', () => { if (!document.hidden) retry(); });
window.GenieAuth = { getState, subscribe, signIn, signOut, retry, getClient: () => client };
})();
