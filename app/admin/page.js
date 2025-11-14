'use client'
import { redirect } from "next/navigation";

export default function TestPage() {
    redirect("/admin/data-reception");
    return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 p-8">
        </div>
    );
}