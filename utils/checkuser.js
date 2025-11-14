export const dynamic = 'force-dynamic';
import jwt from 'jsonwebtoken';

// Note: Đây là hàm check và lấy token được truyền vào api. 2 Trường hợp cho 2 đối tượng là client và server
export default async function CheckToken(request) {
  let source;
  let token;
  let body;

  try {
    body = await request.clone().json();
    source = body?.source;
  } catch (err) {
    source = 0;
  }

  try {
    if (source) {
      const authHeader = request.headers.get('authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { error: 'Token không được cung cấp trong header' };
      }
      token = authHeader.split(' ')[1];
    } else {
      token = request.cookies.get(process.env.token)?.value;
      if (!token) {
        return { error: 'Token không được cung cấp trong cookie' };
      }
    }
    let decodedToken;
    try {
      decodedToken = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return { error: 'Token không hợp lệ hoặc đã hết hạn ' + token };
    }

    return { user: decodedToken, body: body };
  } catch (error) {
    return { error: `Có lỗi xảy ra: ${source}` };
  }
}
