// app/workflows/[id]/builder/page.jsx
import { getWorkflowDefOne } from '@/data/workflows/handledata.db';
import WorkflowGridBuilder from '@/components/workflows/WorkflowGridBuilder';

export const dynamic = 'force-dynamic';

export default async function BuilderPage({ params }) {
    params = await params
    let def = await getWorkflowDefOne(params.id);
    def = JSON.parse(JSON.stringify(def));
    if (!def) return <div className="p-6">Không tìm thấy Workflow</div>;
    return <WorkflowGridBuilder definition={def} />;
}
