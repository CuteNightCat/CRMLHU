import connectDB from '@/config/connectDB'
import Area from '@/models/area'
import jsonRes from '@/utils/response'
import { reloadArea } from '@/data/actions/reload'
import authenticate from '@/utils/authenticate'

export async function POST(request) {
    try {
        const { user, body } = await authenticate(request)
        if (!user.role.includes('Admin')) {
            return jsonRes(403, { status: false, mes: 'Không có quyền truy cập chức năng này.', data: [] })
        }
        await connectDB()
        const { name, rooms, color } = body
        if (!name || !rooms?.length || !color) {
            return jsonRes(400, { status: false, mes: 'Nhập đầy đủ thông tin trước khi tạo khu vực.', data: [] })
        }
        if (await Area.exists({ name })) {
            return jsonRes(409, { status: false, mes: `Khu vực "${name}" đã tồn tại.`, data: [] })
        }
        const normRooms = rooms.map((r) => typeof r === 'string' ? { name: r.trim() } : { name: String(r.name).trim() })
        const newArea = await Area.create({ name: name.trim(), rooms: normRooms, color })
        await reloadArea()
        return jsonRes(201, { status: true, mes: 'Tạo khu vực thành công', data: newArea })
    } catch (err) {
        const code = err.message === 'Authentication failed' ? 401 : 500
        return jsonRes(code, { status: false, mes: err.message, data: [] })
    }
}
