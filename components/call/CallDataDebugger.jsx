"use client";

import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Database, User, Phone } from 'lucide-react';
import { call_data, reloadCallsByCustomer } from '@/data/call/wraperdata.db';

export default function CallDataDebugger({ customerId, customerName }) {
    const [calls, setCalls] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [debugInfo, setDebugInfo] = useState({});

    const loadCalls = async () => {
        if (!customerId) return;
        
        try {
            setLoading(true);
            setError(null);
            
            console.log('🔍 [CallDataDebugger] Loading calls for customer:', customerId);
            
            const result = await call_data({ customerId });
            console.log('🔍 [CallDataDebugger] Result:', result);
            
            setCalls(result || []);
            setDebugInfo({
                customerId,
                customerName,
                totalCalls: result?.length || 0,
                timestamp: new Date().toLocaleString('vi-VN')
            });
            
        } catch (err) {
            console.error('❌ [CallDataDebugger] Error:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const forceReload = async () => {
        try {
            setLoading(true);
            console.log('🔄 [CallDataDebugger] Force reloading for customer:', customerId);
            
            await reloadCallsByCustomer(customerId);
            await loadCalls();
            
        } catch (err) {
            console.error('❌ [CallDataDebugger] Force reload error:', err);
            setError(err.message);
        }
    };

    useEffect(() => {
        loadCalls();
    }, [customerId]);

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Database className="h-5 w-5" />
                        Debug Call Data
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {/* Debug Info */}
                        <div className="bg-gray-50 rounded-lg p-4">
                            <h3 className="font-medium mb-2">Debug Information:</h3>
                            <div className="text-sm space-y-1">
                                <div><strong>Customer ID:</strong> {debugInfo.customerId}</div>
                                <div><strong>Customer Name:</strong> {debugInfo.customerName}</div>
                                <div><strong>Total Calls Found:</strong> {debugInfo.totalCalls}</div>
                                <div><strong>Last Updated:</strong> {debugInfo.timestamp}</div>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2">
                            <Button onClick={loadCalls} disabled={loading} variant="outline">
                                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Database className="h-4 w-4 mr-2" />}
                                Load Calls
                            </Button>
                            <Button onClick={forceReload} disabled={loading} variant="outline">
                                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                                Force Reload
                            </Button>
                        </div>

                        {/* Error Display */}
                        {error && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                                <p className="text-red-700 text-sm">
                                    <strong>Error:</strong> {error}
                                </p>
                            </div>
                        )}

                        {/* Results */}
                        {loading ? (
                            <div className="text-center py-4">
                                <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                                <p className="text-sm text-gray-600">Đang tải dữ liệu...</p>
                            </div>
                        ) : calls.length > 0 ? (
                            <div className="space-y-3">
                                <h3 className="font-medium">Found {calls.length} calls:</h3>
                                {calls.map((call, index) => (
                                    <div key={call._id} className="bg-white border border-gray-200 rounded-lg p-3">
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <Phone className="h-4 w-4 text-gray-500" />
                                                    <span className="font-medium">Call #{index + 1}</span>
                                                    <Badge variant={call.status === 'completed' ? 'default' : 'secondary'}>
                                                        {call.status}
                                                    </Badge>
                                                </div>
                                                <div className="text-xs text-gray-600 space-y-1">
                                                    <div><strong>ID:</strong> {call._id}</div>
                                                    <div><strong>Customer:</strong> {call.customer?.name || 'N/A'}</div>
                                                    <div><strong>User:</strong> {call.user?.name || 'N/A'}</div>
                                                    <div><strong>Duration:</strong> {call.duration}s</div>
                                                    <div><strong>Created:</strong> {new Date(call.createdAt).toLocaleString('vi-VN')}</div>
                                                    <div><strong>File ID:</strong> {call.file}</div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-8 text-gray-500">
                                <User className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                                <p>Không tìm thấy cuộc gọi nào cho khách hàng này.</p>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
