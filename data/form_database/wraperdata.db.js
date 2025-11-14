'use server'

import { getFormAll, getFormOne } from './handledata.db'
import { revalidateTag } from 'next/cache'

// Lấy danh sách form/Load dữ liệu
export async function form_data(id) {
    if (id) {
        return await getFormOne(id)
    }
    return await getFormAll()
}
export async function reloadForm() {
    revalidateTag('forms')
}