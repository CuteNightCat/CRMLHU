import LabelManager from './ui/LabelManager';
import dbConnect from '@/config/connectDB';
import Label from '@/models/label.model';

export async function getLabelData() {
    try {
        await dbConnect();
        const allLabels = await Label.find({}).sort({ createdAt: 'desc' });
        console.log(allLabels);
        
        return JSON.parse(JSON.stringify(allLabels));
    } catch (error) {
        console.error("Failed to fetch labels:", error);
        return [];
    }
}

export default async function HomePage() {
    const allLabels = await getLabelData();

    return (
        <main className="flex h-full flex-col">
            <div className="w-full bg-white rounded-md">
                <LabelManager initialLabels={allLabels} />
            </div>
        </main>
    );
}