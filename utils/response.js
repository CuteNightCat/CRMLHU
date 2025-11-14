import { NextResponse } from 'next/server'

export const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
}

export default function jsonRes(statusCode = 200, body = { status: true, mes: '', data: null }) {
    return new NextResponse(JSON.stringify(body), {
        status: statusCode,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
}