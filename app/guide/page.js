import GuideContent from './ui/GuideContent';

export default async function GuidePage() {
    return (
        <main className="flex h-full flex-col">
            <div className="w-full bg-white rounded-md p-6">
                <GuideContent />
            </div>
        </main>
    );
}
