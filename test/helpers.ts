import { signSession } from '../src/auth/session';

export async function adminCookie(): Promise<string> {
  return `ld_session=${await signSession({ id: '111', name: 'T' }, 'test-secret')}`;
}
