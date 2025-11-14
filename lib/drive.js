// lib/drive.js
import { google } from 'googleapis';
import { Readable } from 'node:stream';

export async function getDriveClient() {
    const auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: process.env.GOOGLE_CLIENT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        },
        scopes: ['https://www.googleapis.com/auth/drive'],
    });

    return google.drive({ version: 'v3', auth });
}

export async function uploadFileToDrive(file, folderId) {
    try {
        const drive = await getDriveClient();
        
        const response = await drive.files.create({
            requestBody: {
                name: file.name,
                parents: [folderId],
            },
            media: {
                mimeType: file.type,
                body: file,
            },
            fields: 'id, name, webViewLink',
        });

        return response.data;
    } catch (error) {
        console.error('Upload to Drive error:', error);
        throw new Error('Failed to upload file to Drive');
    }
}

export async function getFileFromDrive(fileId) {
    try {
        const drive = await getDriveClient();
        
        const response = await drive.files.get({
            fileId,
            fields: 'id, name, mimeType, size, webViewLink',
        });

        return response.data;
    } catch (error) {
        console.error('Get file from Drive error:', error);
        throw new Error('Failed to get file from Drive');
    }
}

// Tạo folder nếu chưa tồn tại
export async function ensureFolderExists(folderId, folderName = 'Service Images') {
    try {
        const drive = await getDriveClient();
        
        // Kiểm tra folder có tồn tại không
        try {
            const response = await drive.files.get({
                fileId: folderId,
                fields: 'id, name',
                supportsAllDrives: true
            });
            console.log(`✅ Folder exists: ${response.data.name}`);
            return folderId;
        } catch (error) {
            if (error.code === 404) {
                console.log(`❌ Folder ${folderId} not found, creating new folder...`);
                
                // Tạo folder mới
                const folderResponse = await drive.files.create({
                    requestBody: {
                        name: folderName,
                        mimeType: 'application/vnd.google-apps.folder'
                    },
                    fields: 'id, name',
                    supportsAllDrives: true
                });
                
                console.log(`✅ Created new folder: ${folderResponse.data.name} (${folderResponse.data.id})`);
                return folderResponse.data.id;
            }
            throw error;
        }
    } catch (error) {
        console.error('Error ensuring folder exists:', error);
        throw error;
    }
}

export async function uploadBufferToDrive(bufferOrOptions, fileName, folderId, mimeType = 'application/octet-stream') {
    try {
        const drive = await getDriveClient();
        
        // Hỗ trợ cả hai cách gọi: với object hoặc với tham số riêng lẻ
        let buffer, name, folder, mime;
        
        if (typeof bufferOrOptions === 'object' && bufferOrOptions !== null && !Buffer.isBuffer(bufferOrOptions)) {
            // Gọi với object: { buffer, name, mime, folderId }
            buffer = bufferOrOptions.buffer;
            name = bufferOrOptions.name;
            folder = bufferOrOptions.folderId;
            mime = bufferOrOptions.mime;
        } else {
            // Gọi với tham số riêng lẻ: (buffer, fileName, folderId, mimeType)
            buffer = bufferOrOptions;
            name = fileName;
            folder = folderId;
            mime = mimeType;
        }
        
        // Sử dụng folder ID trực tiếp (không tạo folder mới)
        const validFolderId = folder;
        
        // Convert buffer to readable stream
        const stream = new Readable({
            read() {
                this.push(buffer);
                this.push(null);
            }
        });
        
        const response = await drive.files.create({
            requestBody: {
                name: name,
                parents: [validFolderId],
            },
            media: {
                mimeType: mime,
                body: stream,
            },
            fields: 'id, name, webViewLink',
            supportsAllDrives: true
        });

        return response.data;
    } catch (error) {
        console.error('Upload buffer to Drive error:', error);
        throw new Error('Failed to upload buffer to Drive');
    }
}

// Tạo URL view từ file ID
export function viewUrlFromId(fileId) {
    if (!fileId) return null;
    return `https://drive.google.com/file/d/${fileId}/view`;
}