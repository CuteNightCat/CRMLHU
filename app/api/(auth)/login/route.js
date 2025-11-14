import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import connectDB from '@/config/connectDB';
import users from '@/models/users';

export async function POST(req) {
  try {
    const cookieStore = await cookies();
    await connectDB();
    const { email, password, re } = await req.json();
    console.log('login payload', { email, password, re });

    const user = await users.findOne({ email }).lean();
    console.log(user,1);
    

    if (!user) return jsonRes(404, { status: 1, mes: 'Tài khoản không tồn tại!', data: [] });

    const ok = await bcrypt.compare(password, user.uid);
    if (!ok) return jsonRes(401, { status: 1, mes: 'Mật khẩu không chính xác!', data: [] });

    const jwtLife = re ? '30d' : '1h';
    const accessToken = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: jwtLife }
    );
    const opts = {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    };
    if (re) opts.maxAge = 60 * 60 * 24 * 30;

    cookieStore.set(process.env.token, accessToken, opts);
    return jsonRes(200, { status: 2, mes: 'Đăng nhập thành công', data: [] });
  } catch (err) {
    console.error(err);
    return jsonRes(500, { status: 1, mes: 'Lỗi máy chủ', data: [] });
  }
}


export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
function jsonRes(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}
