
import ModelConfigurationV2 from "@/components/ModelConfigurationV2";
import { SETTINGS_DOCUMENTATION_URLS } from "@/constants/documentation";

export const dynamic = 'force-dynamic';

interface ServiceConfigurationPageProps {
    searchParams?: Promise<{
        action?: string | string[];
    }>;
}

export default async function ServiceConfigurationPage({ searchParams }: ServiceConfigurationPageProps) {
    const params = searchParams ? await searchParams : {};
    const action = Array.isArray(params.action) ? params.action[0] : params.action;

    return (
        <div className="min-h-screen">
            <div className="px-4 lg:px-6 pt-2 pb-6">
                <ModelConfigurationV2
                    docsUrl={SETTINGS_DOCUMENTATION_URLS.modelOverrides}
                    initialAction={action}
                />
            </div>
        </div>
    );
}
