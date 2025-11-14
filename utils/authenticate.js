import CheckToken from './checkuser';

export default async function authenticate(request) {
  const { user, error, body } = await CheckToken(request);
  if (error || !user) throw new Error(error || 'Authentication failed')
  return { user, body }
}; 