'use strict';

const USER = { id: '00000000-0000-4000-8000-000000000001', email: 'member@example.test',
  app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, aud: 'authenticated', role: 'authenticated' };
const session = () => ({ access_token: 'member-access-token', refresh_token: 'member-refresh-token',
  token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER });

async function installMember(page) {
  await page.addInitScript(value => {
    localStorage.setItem('sb-llqwzrgzekalwdnetvyb-auth-token', JSON.stringify(value));
  }, session());
  await page.route('https://llqwzrgzekalwdnetvyb.supabase.co/**', route => {
    const url = new URL(route.request().url());
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token')
      return route.fulfill({ status: 200, headers, body: JSON.stringify(session()) });
    if (url.pathname === '/rest/v1/app_admins')
      return route.fulfill({ status: 200, headers, body: '[{"display_name":"測試成員","active":true}]' });
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers });
    if (url.pathname === '/rest/v1/customer_leads') return route.fulfill({ status: 200, headers, body: '[]' });
    return route.fulfill({ status: 500, headers, body: '{}' });
  });
}

module.exports = { USER, session, installMember };
