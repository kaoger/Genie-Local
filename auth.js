'use strict';
(() => {
/* ================= Supabase 登入狀態 ================= */
const { supabaseUrl, supabasePublishableKey } = window.GENIE_CONFIG;
// supabase-js 可能在未登入時把第二個參數放進 Authorization；攔下後只保留 apikey。
const safeFetch = (input, init = {}) => {
  const headers = new Headers(init.headers);
  if (headers.get('Authorization') === `Bearer ${supabasePublishableKey}`) headers.delete('Authorization');
  return fetch(input, { ...init, headers });
};
const client = window.supabase.createClient(supabaseUrl, supabasePublishableKey, {
  auth: { detectSessionInUrl: false },
  global: { fetch: safeFetch },
});
let state = { status: 'checking', displayName: '', email: '' };
let generation = 0;
let denied = false;
let pending = null;
const listeners = new Set();
const getState = () => ({ ...state });
function setState(status, displayName = '', email = '') {
  state = { status, displayName, email };
  listeners.forEach(listener => listener(getState()));
}
function subscribe(listener) {
  listeners.add(listener);
  listener(getState());
  return () => listeners.delete(listener);
}
const networkError = error => error?.status === 0 || /fetch|network|連線/i.test(error?.message || '');

async function checkMember(session) {
  const uid = session?.user?.id;
  if (!uid) { setState('signedOut'); return { error: null }; }
  if (pending?.uid === uid) return pending.promise;
  const current = ++generation;
  setState('checking');
  const promise = (async () => {
    try {
      const { data, error } = await client.from('app_admins')
        .select('display_name,active').eq('user_id', uid).maybeSingle();
      if (current !== generation) return { error: null };
      if (error) {
        await client.auth.signOut({ scope: 'local' });
        return { error: networkError(error) ? '無法連線，請稍後再試' : '此帳號沒有權限，請聯絡管理者' };
      }
      if (!data || data.active !== true) {
        denied = true;
        setState('denied');
        await client.auth.signOut({ scope: 'local' });
        return { error: '此帳號沒有權限，請聯絡管理者' };
      }
      denied = false;
      setState('member', data.display_name || '', session.user.email || '');
      return { error: null };
    } catch (error) {
      if (current === generation) await client.auth.signOut({ scope: 'local' });
      return { error: '無法連線，請稍後再試' };
    }
  })();
  pending = { uid, promise };
  try { return await promise; }
  finally { if (pending?.promise === promise) pending = null; }
}

async function signIn(email, password) {
  denied = false;
  setState('checking');
  try {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      setState('signedOut');
      return { error: networkError(error) ? '無法連線，請稍後再試' : '帳號或密碼錯誤' };
    }
    return await checkMember(data.session);
  } catch (error) {
    setState('signedOut');
    return { error: '無法連線，請稍後再試' };
  }
}

async function signOut() {
  denied = false;
  ++generation;
  await client.auth.signOut({ scope: 'local' });
  setState('signedOut');
}

client.auth.onAuthStateChange((event, session) => {
  if (!session) {
    ++generation;
    setState(denied ? 'denied' : 'signedOut');
    return;
  }
  // Auth 回呼內不要 await Supabase API；排到下一個 microtask 避免內部鎖相互等待。
  queueMicrotask(() => { checkMember(session); });
});

window.GenieAuth = { getState, subscribe, signIn, signOut, getClient: () => client };
})();
