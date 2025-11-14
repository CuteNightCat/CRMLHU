// lib/workflow.db.js

import { WorkflowTemplate } from '@/models/workflows.model';
import connectDB from '@/config/connectDB';
import { cacheData } from '@/lib/cache';

async function dataWorkflow(id) {
  try {
    await connectDB();
    const aggregationPipeline = [
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: 'customerworkflows',
          localField: '_id',
          foreignField: 'templateId',
          as: 'customerWorkflows'
        }
      },
      {
        $addFields: {
          customerCount: { $size: '$customerWorkflows' },
        }
      },
      { $project: { customerWorkflows: 0 } }
    ];
    let workflows;
    if (id) {
      workflows = await WorkflowTemplate.findById(id).lean();
    } else {
      workflows = await WorkflowTemplate.aggregate(aggregationPipeline);
    }
    return JSON.parse(JSON.stringify(workflows));
  } catch (error) {
    console.error('Lỗi trong dataWorkflow:', error);
    throw new Error('Không thể lấy dữ liệu workflow.');
  }
}

export async function getWorkflowAll() {
  try {
    const cachedFunction = cacheData(() => dataWorkflow(), ['workflows']);
    return await cachedFunction();
  } catch (error) {
    console.error('Lỗi trong getWorkflowAll:', error);
    throw new Error('Không thể lấy dữ liệu workflow.');
  }
}

export async function getWorkflowOne(id) {
  try {
    const cachedFunction = cacheData(() => dataWorkflow(id), ['workflows', id]);
    return await cachedFunction();
  } catch (error) {
    console.error('Lỗi trong getWorkflowOne:', error);
    throw new Error('Không thể lấy dữ liệu workflow.');
  }
}