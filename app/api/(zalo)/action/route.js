import { NextResponse } from 'next/server';
import ScheduledJob from "@/models/schedule";
import ZaloAccount from "@/models/zalo.model";
import Customer from "@/models/customer.model";
import Variant from "@/models/variant.model";
import Logs from "@/models/log.model";
import dbConnect from "@/config/connectDB";
import { actionZalo } from '@/function/drive/appscript';

export async function formatMessage(template, targetDoc, zaloAccountDoc) {
    if (!template) return "";
    let message = template;

    message = message.replace(/{name}/g, targetDoc.name || "");
    message = message.replace(/{nameparent}/g, targetDoc.nameparent || "");
    message = message.replace(/{namezalo}/g, targetDoc.zaloname || "");

    const variantPlaceholders = message.match(/{[^{}]+}/g) || [];
    for (const placeholder of variantPlaceholders) {
        const variantName = placeholder.slice(1, -1);
        const variant = await Variant.findOne({ name: variantName }).lean();
        if (variant && variant.phrases && variant.phrases.length > 0) {
            const randomPhrase = variant.phrases[Math.floor(Math.random() * variant.phrases.length)];
            message = message.replace(placeholder, randomPhrase);
        }
    }
    console.log(message);

    return message;
}

async function processSingleTask(taskDetail) {
    const { task, job, zaloAccount } = taskDetail;

    try {
        // Luôn làm việc với model Customer
        const TargetModel = Customer;
        const targetId = task.person._id;

        const targetDoc = await TargetModel.findById(targetId).lean();

        if (!targetDoc) {
            throw new Error(`Target document not found in Customer with _id: ${targetId}`);
        }

        let apiResponse;
        let errorMessageForLog = null;
        const actionType = job.actionType;
        let uidPerson = null;

        // Logic tìm uidPerson chỉ áp dụng cho Customer
        if (actionType === 'addFriend' || actionType === 'sendMessage' || actionType === 'checkFriend') {
            const uidEntry = targetDoc.uid?.find(u => u.zalo?.toString() === zaloAccount._id.toString());
            if (!uidEntry || !uidEntry.uid) {
                errorMessageForLog = "Không tìm thấy UID của khách hàng tương ứng với tài khoản Zalo thực hiện.";
                apiResponse = { status: false, message: errorMessageForLog, content: { error_code: -1, error_message: errorMessageForLog, data: {} } };
            } else {
                uidPerson = uidEntry.uid;
            }
        }

        let finalMessage = "";
        if (!errorMessageForLog) {
            finalMessage = await formatMessage(job.config.messageTemplate, targetDoc, zaloAccount);
            apiResponse = await actionZalo({
                phone: targetDoc.phone,
                uidPerson: uidPerson,
                actionType: actionType,
                message: finalMessage,
                uid: zaloAccount.uid,
            });
        }

        const logPayload = {
            message: finalMessage || errorMessageForLog,
            status: {
                status: apiResponse.status,
                message: apiResponse.message,
                data: {
                    error_code: apiResponse.content?.error_code,
                    error_message: apiResponse.content?.error_message,
                }
            },
            type: actionType,
            createBy: job.createdBy,
            customer: targetId, // Chỉ sử dụng trường customer
            zalo: job.zaloAccount,
            schedule: job._id,
        };
        const newLog = await Logs.create(logPayload);
        const errorCode = apiResponse.content?.error_code;

        if (actionType === 'findUid') {
            if (errorCode === 0) {
                const updateData = {
                    zaloavt: apiResponse.content.data.avatar,
                    zaloname: apiResponse.content.data.zalo_name,
                };
                await TargetModel.findByIdAndUpdate(targetId, { $set: updateData });

                const newUidValue = apiResponse.content.data.uid;
                const updateResult = await TargetModel.updateOne(
                    { _id: targetId, 'uid.zalo': zaloAccount._id },
                    { $set: { 'uid.$.uid': newUidValue } }
                );
                if (updateResult.matchedCount === 0) {
                    await TargetModel.findByIdAndUpdate(
                        targetId,
                        { $push: { uid: { zalo: zaloAccount._id, uid: newUidValue } } }
                    );
                }
            } else if ([216, 212, 219].includes(errorCode)) {
                await TargetModel.findByIdAndUpdate(targetId, { $set: { uid: null } });
            }
        }
        if (actionType === 'checkFriend') {
            const friendStatus = Number(apiResponse.content?.error_message);
            if (!isNaN(friendStatus)) {
                await TargetModel.updateOne(
                    { _id: targetId },
                    { $set: { "uid.$[elem].isFriend": friendStatus } },
                    { arrayFilters: [{ "elem.zalo": zaloAccount._id }] }
                );
            }
        }
        if (actionType === 'addFriend' && apiResponse.status === true) {
            await TargetModel.updateOne(
                { _id: targetId },
                { $set: { "uid.$[elem].isReques": 1 } },
                { arrayFilters: [{ "elem.zalo": zaloAccount._id }] }
            );
        }

        await ScheduledJob.updateOne(
            { _id: job._id, 'tasks._id': task._id },
            { $set: { 'tasks.$.history': newLog._id } }
        );

        const statsUpdateField = apiResponse.status ? 'statistics.completed' : 'statistics.failed';
        const updatedJob = await ScheduledJob.findByIdAndUpdate(
            job._id,
            { $inc: { [statsUpdateField]: 1 } },
            { new: true }
        ).lean();

        if (updatedJob) {
            const { completed, failed, total } = updatedJob.statistics;
            if ((completed + failed) >= total) {
                await ZaloAccount.findByIdAndUpdate(
                    job.zaloAccount,
                    { $pull: { action: job._id } }
                );
            }
        }
    } catch (error) {
        console.error(`[Scheduler] Error processing task ${task._id} from job ${job._id}:`, error);
        await ScheduledJob.findByIdAndUpdate(job._id, { $inc: { 'statistics.failed': 1 } });
    }
}

export async function GET(request) {
    try {
        await dbConnect();
        const now = new Date();
        const oneMinuteLater = new Date(now.getTime() + 60 * 1000);
        const dueTasksDetails = await ScheduledJob.aggregate([
            { $match: { 'tasks.status': false, 'tasks.scheduledFor': { $lte: oneMinuteLater } } },
            { $unwind: '$tasks' },
            { $match: { 'tasks.status': false, 'tasks.scheduledFor': { $lte: oneMinuteLater } } },
            {
                $lookup: {
                    from: 'zaloaccounts',
                    localField: 'zaloAccount',
                    foreignField: '_id',
                    as: 'zaloAccountInfo'
                }
            },
            { $match: { 'zaloAccountInfo': { $ne: [] } } },
            { $sort: { 'tasks.scheduledFor': 1 } },
            {
                $project: {
                    _id: 0,
                    job: { _id: '$_id', jobName: '$jobName', actionType: '$actionType', zaloAccount: '$zaloAccount', config: '$config', createdBy: '$createdBy' },
                    task: '$tasks',
                    zaloAccount: { $arrayElemAt: ['$zaloAccountInfo', 0] }
                }
            }
        ]);

        if (dueTasksDetails.length === 0) {
            return NextResponse.json({ message: 'No due tasks to process.' }, { status: 200 });
        }

        const taskUpdateOperations = dueTasksDetails.map(detail => ({
            updateOne: {
                filter: { _id: detail.job._id, 'tasks._id': detail.task._id },
                update: { $set: { 'tasks.$.status': true } }
            }
        }));
        await ScheduledJob.bulkWrite(taskUpdateOperations);

        for (const taskDetail of dueTasksDetails) {
            processSingleTask(taskDetail);
        }

        return NextResponse.json({
            message: `Scheduler triggered. Processing ${dueTasksDetails.length} tasks in the background.`
        }, { status: 202 });

    } catch (error) {
        console.error('[Scheduler API Error]', error);
        return NextResponse.json(
            { message: 'Internal Server Error', error: error.message },
            { status: 500 }
        );
    }
}