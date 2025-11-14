import { form_data } from '@/data/form_database/wraperdata.db';
import { workflow_data } from '@/data/workflow/wraperdata.db';
import WorkflowManager from './ui/WorkflowManager';

export default async function WorkflowPage() {
  const workflows = await workflow_data(null, 'all');
  const forms = await form_data();
  return <WorkflowManager initialWorkflows={workflows} forms={forms} />;
}