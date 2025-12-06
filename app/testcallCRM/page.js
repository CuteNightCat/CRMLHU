'use client'

import TestCallComponent from './TestCallComponent';

export default function TestCallPage() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
            <div className="max-w-4xl mx-auto">
                <div className="mb-6 text-center">
                    <h1 className="text-3xl font-bold text-gray-800 mb-2">Test Call CRM</h1>
                    <p className="text-gray-600 mb-1">Trang test cuộc gọi với số điện thoại cố định</p>
                    <p className="text-sm text-gray-500">Số điện thoại test: <span className="font-semibold text-blue-600">0346270820</span></p>
                </div>
                <TestCallComponent />
            </div>
        </div>
    );
}

