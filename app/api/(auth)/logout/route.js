export const dynamic = 'force-dynamic';
import { cookies } from 'next/headers';

export async function POST() {
    const cookieStore = await cookies();
    const u = cookieStore.get(process.env.token)?.value;
    if (!u) { return new Response(JSON.stringify({ error: 'No refresh token found' }), { status: 401 }) }
    cookieStore.set(process.env.token, '', {
        httpOnly: true,
        path: '/',
        maxAge: 0,
    });
    return new Response(JSON.stringify({ message: 'Logged out successfully' }), { status: 200 });
}