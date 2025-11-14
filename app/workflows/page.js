// app/workflows/page.jsx
import Link from "next/link";
import { getWorkflowDefsAll } from "@/data/workflows/handledata.db";
import { createWorkflowDefinition } from "@/data/workflows/actions";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
    const defs = await getWorkflowDefsAll();

    async function actionCreate(formData) {
        "use server";
        const id = await createWorkflowDefinition(formData);
        revalidatePath("/workflows");
        return id;
    }

    return (
        <div className="flex flex-col gap-2">
            <form
                action={actionCreate}
                className="rounded-md border p-4 grid grid-cols-1 md:grid-cols-4 gap-3"
            >
                <input
                    name="name"
                    placeholder="Tên workflow"
                    className="border rounded px-3 py-2"
                    required
                />
                <input
                    name="description"
                    placeholder="Mô tả (tuỳ chọn)"
                    className="border rounded px-3 py-2"
                />
                <button
                    type="submit"
                    className="rounded px-4 py-2 bg-black text-white hover:opacity-90"
                >
                    Tạo workflow
                </button>
            </form>

            {/* Danh sách workflows */}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {defs?.map((d) => (
                    <div key={d._id} className="rounded-md border p-4 space-y-2">
                        <div className="font-medium">{d.name}</div>
                        <div className="text-sm text-muted-foreground">
                            {d.description || "—"}
                        </div>
                        <div className="text-sm">
                            <div>• Số bước: <b>{d.nodeCount}</b></div>
                            <div>• Số liên kết: <b>{d.edgeCount}</b></div>
                        </div>
                        <div className="flex items-center gap-2 pt-2">
                            <Link
                                className="px-3 py-1.5 rounded border hover:bg-gray-50"
                                href={`/workflows/${d._id}/builder`}
                            >
                                Sửa (Builder)
                            </Link>
                            <Link
                                className="px-3 py-1.5 rounded border hover:bg-gray-50"
                                href={`/workflows/${d._id}/viewer`}
                            >
                                Xem (Viewer)
                            </Link>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
