import { Suspense } from 'react';

import { getWorkflowsApiV1WorkflowFetchGet, listFoldersApiV1FolderGet } from '@/client/sdk.gen';
import type { FolderResponse, WorkflowListResponse } from '@/client/types.gen';
import { Card, CardContent } from '@/components/ui/card';
import { getServerAccessToken } from '@/lib/auth/server';
import logger from '@/lib/logger';

import WorkflowLayout from "./WorkflowLayout";
import { WorkflowSearchWrapper } from './WorkflowSearchWrapper';

export const dynamic = 'force-dynamic';

// Server component to fetch workflows and folders
async function WorkflowPageDataFetcher() {
    const accessToken = await getServerAccessToken();

    if (!accessToken) {
        return (
            <WorkflowSearchWrapper workflows={[]} folders={[]} />
        );
    }

    const authHeaders = {
        'Authorization': `Bearer ${accessToken}`,
    };

    try {
        // Fetch workflows and folders in parallel with catch handlers
        const [workflowsResponse, foldersResponse] = await Promise.all([
            getWorkflowsApiV1WorkflowFetchGet({
                headers: authHeaders,
                query: {
                    status: 'active,archived'
                }
            }).catch((wfErr) => {
                logger.error(`Error fetching workflows: ${wfErr}`);
                return { data: [] as WorkflowListResponse[] };
            }),
            listFoldersApiV1FolderGet({
                headers: authHeaders,
            }).catch((folderErr) => {
                logger.error(`Error fetching folders: ${folderErr}`);
                return { data: [] as FolderResponse[] };
            }),
        ]);

        const workflows = workflowsResponse?.data ? (Array.isArray(workflowsResponse.data) ? workflowsResponse.data : [workflowsResponse.data]) : [];
        const folders = foldersResponse?.data ?? [];

        return (
            <WorkflowSearchWrapper workflows={workflows} folders={folders} />
        );
    } catch (err) {
        logger.error(`Error fetching workflows: ${err}`);
        return (
            <WorkflowSearchWrapper workflows={[]} folders={[]} />
        );
    }
}

function WorkflowsLoading() {
    return (
        <div className="container mx-auto px-4 py-8">
            {/* Get Started Section Loading */}
            <div className="mb-12">
                <div className="h-8 w-48 bg-muted rounded mb-6"></div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {Array.from({ length: 3 }, (_, i) => (
                        <Card key={i}>
                            <CardContent className="p-0">
                                <div className="h-40 bg-muted/70" />
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>

            {/* Your Workflows Section Loading */}
            <div className="mb-6">
                <Card>
                    <CardContent className="p-0">
                        <div className="h-96 bg-muted/70" />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

export default function WorkflowPage() {
    return (
        <WorkflowLayout showFeaturesNav={true}>
            <Suspense fallback={<WorkflowsLoading />}>
                <WorkflowPageDataFetcher />
            </Suspense>
        </WorkflowLayout>
    );
}
