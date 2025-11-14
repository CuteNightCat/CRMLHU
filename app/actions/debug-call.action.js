'use server';

import connectDB from '@/config/connectDB';
import checkAuthToken from '@/utils/checktoken';
import getDriveClient from '@/function/drive/index';
import Call from '@/models/call.model';

export async function debugSpecificCall(callId) {
    try {
        console.log('🔍 [debugSpecificCall] Starting debug for callId:', callId);
        
        const session = await checkAuthToken();
        if (!session?.id) {
            return { success: false, error: 'Unauthorized' };
        }

        await connectDB();

        // 1. Get call data
        const call = await Call.findById(callId).populate({ path: 'user', select: 'name role' }).lean();
        console.log('🔍 [debugSpecificCall] Call data:', call);
        
        if (!call) {
            return { success: false, error: 'Call not found' };
        }

        // 2. Check permissions
        const isAdmin = Array.isArray(session.role) ? session.role.includes('Admin') : false;
        const isOwner = String(call.user?._id || call.user) === String(session.id);
        const hasPermission = isAdmin || isOwner;
        
        console.log('🔍 [debugSpecificCall] Permission check:', {
            sessionId: session.id,
            callUserId: call.user?._id,
            isAdmin,
            isOwner,
            hasPermission
        });

        if (!hasPermission) {
            return { success: false, error: 'Access denied' };
        }

        // 3. Test Drive access
        const drive = await getDriveClient();
        const fileId = call.file;
        
        console.log('🔍 [debugSpecificCall] Testing Drive access for fileId:', fileId);
        
        // Test metadata access
        const metaRes = await drive.files.get({
            fileId,
            fields: 'name, mimeType, size, permissions',
            supportsAllDrives: true 
        });
        
        console.log('🔍 [debugSpecificCall] Drive metadata:', metaRes.data);
        
        // Test file access (without downloading)
        const fileRes = await drive.files.get({
            fileId,
            fields: 'id, name, size, mimeType',
            supportsAllDrives: true
        });
        
        console.log('🔍 [debugSpecificCall] Drive file access:', fileRes.data);

        return {
            success: true,
            data: {
                call: {
                    _id: call._id,
                    customer: call.customer,
                    user: call.user,
                    file: call.file,
                    status: call.status,
                    duration: call.duration,
                    createdAt: call.createdAt
                },
                drive: {
                    fileId: fileRes.data.id,
                    name: fileRes.data.name,
                    size: fileRes.data.size,
                    mimeType: fileRes.data.mimeType
                },
                permissions: {
                    isAdmin,
                    isOwner,
                    hasPermission
                }
            }
        };

    } catch (error) {
        console.error('❌ [debugSpecificCall] Error:', error);
        return {
            success: false,
            error: error.message,
            details: {
                code: error.code,
                status: error.status,
                message: error.message
            }
        };
    }
}
