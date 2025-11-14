import connectDB from '@/config/connectDB'
import Area from '@/models/area'
import authenticate from '@/utils/authenticate'
import jsonRes from '@/utils/response'
import { reloadArea } from '@/data/actions/reload'

const isHex = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)

export async function PUT(request, { params }) {
    const { id } = await params
    try {
        const { user, body } = await authenticate(request)
        if (!user.role.includes('Admin')) {
            return jsonRes(403, { status: false, mes: 'Không có quyền truy cập chức năng này.', data: [] })
        }
        const { name, rooms, color } = body

        if (!name?.trim() || !rooms?.length || !isHex(color))
            return jsonRes(400, { status: false, mes: 'Dữ liệu không hợp lệ.', data: [] })

        await connectDB()

        if (await Area.exists({ name: name.trim(), _id: { $ne: id } }))
            return jsonRes(409, { status: false, mes: `Tên "${name}" đã tồn tại.`, data: [] })
        const normRooms = rooms.map((r) =>
            typeof r.name === 'string' ? { name: r.name.trim() } : { name: String(r.name).trim() }
        )

        const updated = await Area.findByIdAndUpdate(
            id,
            { name: name.trim(), rooms: normRooms, color },
            { new: true, runValidators: true }
        )
        if (!updated)
            return jsonRes(409, { status: false, mes: `Tên "${name}" đã tồn tại.`, data: [] })
        await reloadArea(id)
        return jsonRes(200, { status: true, mes: 'Cập nhật thành công!', data: updated })
    } catch (e) {
        const code = e.kind === 'ObjectId' ? 400 : e.message === 'Authentication failed' ? 401 : 500
        return jsonRes(code, { status: false, mes: e.message, data: [] })
    }
}
